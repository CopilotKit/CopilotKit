using System.Buffers.Binary;
using System.IO.Compression;

namespace CopilotKit.Intelligence.AgentFramework;

internal static class SnapshotArchive
{
    private sealed record Member(string Name, uint Size, uint CompressedSize, uint Crc);
    private static readonly uint[] CrcTable = CreateCrcTable();

    internal static Dictionary<string, byte[]> Read(byte[] bytes, CancellationToken cancellationToken)
    {
        // Validate raw central/local names before ZipArchive can decode or normalize them.
        var members = Members(bytes);
        using var archive = new ZipArchive(new MemoryStream(bytes, false), ZipArchiveMode.Read, false, SkillSnapshot.Utf8);
        if (archive.Entries.Count != members.Count) throw SkillSnapshot.Invalid();
        var result = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        for (var index = 0; index < members.Count; index++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var member = members[index];
            var entry = archive.Entries[index];
            if (entry.FullName != member.Name || entry.Length != member.Size || entry.CompressedLength != member.CompressedSize)
                throw SkillSnapshot.Invalid();
            if (member.Name.EndsWith('/')) continue;
            using var input = entry.Open();
            using var output = new MemoryStream((int)member.Size);
            var buffer = new byte[8192];
            var crc = uint.MaxValue;
            int count;
            while ((count = input.Read(buffer)) != 0)
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (output.Length + count > member.Size) throw SkillSnapshot.Invalid();
                for (var position = 0; position < count; position++)
                    crc = CrcTable[(crc ^ buffer[position]) & 0xff] ^ (crc >> 8);
                output.Write(buffer, 0, count);
            }
            if (output.Length != member.Size || ~crc != member.Crc) throw SkillSnapshot.Invalid();
            result.Add(member.Name, output.ToArray());
        }
        return result;
    }

    private static List<Member> Members(byte[] bytes)
    {
        var end = bytes.Length - 22;
        while (end >= Math.Max(0, bytes.Length - 65557))
        {
            if (U32(bytes, end) == 0x06054b50 && end + 22 + U16(bytes, end + 20) == bytes.Length) break;
            end--;
        }
        if (end < 0 || U32(bytes, end) != 0x06054b50 || U16(bytes, end + 4) != 0 || U16(bytes, end + 6) != 0)
            throw SkillSnapshot.Invalid();
        var count = U16(bytes, end + 10);
        if (count > 1000 || U16(bytes, end + 8) != count) throw SkillSnapshot.Invalid();
        var offset = checked((int)U32(bytes, end + 16));
        if ((long)offset + U32(bytes, end + 12) != end) throw SkillSnapshot.Invalid();
        var members = new List<Member>();
        var names = new HashSet<string>(StringComparer.Ordinal);
        long total = 0;
        for (var index = 0; index < count; index++)
        {
            if (U32(bytes, offset) != 0x02014b50) throw SkillSnapshot.Invalid();
            var flags = U16(bytes, offset + 8);
            var method = U16(bytes, offset + 10);
            var crc = U32(bytes, offset + 16);
            var compressed = U32(bytes, offset + 20);
            var size = U32(bytes, offset + 24);
            var nameLength = U16(bytes, offset + 28);
            var extraLength = U16(bytes, offset + 30);
            var commentLength = U16(bytes, offset + 32);
            var rawName = Slice(bytes, offset + 46, nameLength);
            var name = SkillSnapshot.Utf8.GetString(rawName);
            var directory = name.EndsWith('/');
            var kind = (U32(bytes, offset + 38) >> 16) & 0xf000;
            if (!SkillSnapshot.SafePath(directory ? name[..^1] : name) || !names.Add(name)
                || kind != 0 && kind != (directory ? 0x4000 : 0x8000)
                || (flags & 1) != 0 || method is not (0 or 8) || U16(bytes, offset + 34) != 0
                || directory && size != 0 || (total += size) > SkillSnapshot.MaxBytes) throw SkillSnapshot.Invalid();
            var local = checked((int)U32(bytes, offset + 42));
            if (U32(bytes, local) != 0x04034b50 || U16(bytes, local + 6) != flags || U16(bytes, local + 8) != method
                || U16(bytes, local + 26) != nameLength || !Slice(bytes, local + 30, nameLength).SequenceEqual(rawName))
                throw SkillSnapshot.Invalid();
            var data = (long)local + 30 + nameLength + U16(bytes, local + 28);
            if (data + compressed > offset || (flags & 8) == 0
                && (U32(bytes, local + 14) != crc || U32(bytes, local + 18) != compressed || U32(bytes, local + 22) != size)) throw SkillSnapshot.Invalid();
            members.Add(new Member(name, size, compressed, crc));
            offset = checked(offset + 46 + nameLength + extraLength + commentLength);
            if (offset > end) throw SkillSnapshot.Invalid();
        }
        if (offset != end) throw SkillSnapshot.Invalid();
        return members;
    }
    private static uint[] CreateCrcTable()
    {
        // ZIP uses the reflected IEEE CRC-32 polynomial, initialized and finalized with all bits set.
        var table = new uint[256];
        for (uint index = 0; index < table.Length; index++)
        {
            var crc = index;
            for (var bit = 0; bit < 8; bit++)
                crc = (crc >> 1) ^ ((crc & 1) == 0 ? 0 : 0xedb88320u);
            table[index] = crc;
        }
        return table;
    }
    private static ReadOnlySpan<byte> Slice(byte[] bytes, int offset, int length)
    {
        if (offset < 0 || length < 0 || (long)offset + length > bytes.Length) throw SkillSnapshot.Invalid();
        return bytes.AsSpan(offset, length);
    }
    private static ushort U16(byte[] bytes, int offset) => BinaryPrimitives.ReadUInt16LittleEndian(Slice(bytes, offset, 2));
    private static uint U32(byte[] bytes, int offset) => BinaryPrimitives.ReadUInt32LittleEndian(Slice(bytes, offset, 4));
}
