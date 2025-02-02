import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "fs";
import { basename } from "path";

export interface VideoToUpload {
  s3ObjectPath: string;
  videoPath: string;
}

export async function uploadVideos(videos: VideoToUpload[]) {
  if (!process.env.GITHUB_ACTIONS_RUN_ID) {
    console.log("Not uploading videos because not in GitHub Actions");
    return;
  }

  // const accessKeyId = process.env.AWS_ACCESS_KEY_ID as string;
  // const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY as string;

  // if (!accessKeyId || !secretAccessKey) {
  //   console.error("AWS credentials not configured - skipping video upload");
  //   return;
  // }

  const s3Client = new S3Client({
    region: "us-east-1",
    // credentials: {
    //   accessKeyId,
    //   secretAccessKey,
    // },
  });

  if (!videos.length) return;

  console.log(`Uploading ${videos.length} test videos to S3...`);

  try {
    const uploadPromises = videos.map(async (video) => {
      console.log(`Uploading video: ${video.s3ObjectPath}`);
      const fileContent = readFileSync(video.videoPath);
      const command = new PutObjectCommand({
        Bucket: "copilotkit-e2e-test-recordings",
        Key: video.s3ObjectPath,
        Body: fileContent,
        ContentType: "video/webm",
      });

      await s3Client.send(command);
      console.log(`Uploaded video: ${basename(video.videoPath)}`);
    });

    await Promise.all(uploadPromises);
    console.log("Uploaded all videos");
    return;
  } catch (error) {
    console.error("Failed to upload videos:", error);
    throw error; // Rethrow to handle in reporter
  }
}
