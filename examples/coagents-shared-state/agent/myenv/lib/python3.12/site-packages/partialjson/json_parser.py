import json

class JSONParser:
    def __init__(self, strict=True):
        self.strict = strict
        self.parsers = {
            ' ': self.parse_space,
            '\r': self.parse_space,
            '\n': self.parse_space,
            '\t': self.parse_space,
            '[': self.parse_array,
            '{': self.parse_object,
            '"': self.parse_string,
            't': self.parse_true,
            'f': self.parse_false,
            'n': self.parse_null
        }
        for c in '0123456789.-':
            self.parsers[c] = self.parse_number

        self.last_parse_reminding = None
        self.on_extra_token = self.default_on_extra_token

    def default_on_extra_token(self, text, data, reminding):
        print('Parsed JSON with extra tokens:', {'text': text, 'data': data, 'reminding': reminding})

    def parse(self, s):
        if len(s) >= 1:
            try:
                return json.loads(s)
            except json.JSONDecodeError as e:
                data, reminding = self.parse_any(s, e)
                self.last_parse_reminding = reminding
                if self.on_extra_token and reminding:
                    self.on_extra_token(s, data, reminding)
                return data
        else:
            return json.loads("{}")

    def parse_any(self, s, e):
        if not s:
            raise e
        parser = self.parsers.get(s[0])
        if not parser:
            raise e
        return parser(s, e)

    def parse_space(self, s, e):
        return self.parse_any(s.strip(), e)

    def parse_array(self, s, e):
        s = s[1:]  # skip starting '['
        acc = []
        s = s.strip()
        while s:
            if s[0] == ']':
                s = s[1:]  # skip ending ']'
                break
            res, s = self.parse_any(s, e)
            acc.append(res)
            s = s.strip()
            if s.startswith(','):
                s = s[1:]
                s = s.strip()
        return acc, s

    def parse_object(self, s, e):
        s = s[1:]  # skip starting '{'
        acc = {}
        s = s.strip()
        while s:
            if s[0] == '}':
                s = s[1:]  # skip ending '}'
                break
            key, s = self.parse_any(s, e)
            s = s.strip()

            if not s or s[0] == '}':
                acc[key] = None
                break

            if s[0] != ':':
                raise e  # or handle this scenario as per your requirement

            s = s[1:]  # skip ':'
            s = s.strip()

            if not s or s[0] in ',}':
                acc[key] = None
                if s.startswith(','):
                    s = s[1:]
                break

            value, s = self.parse_any(s, e)
            acc[key] = value
            s = s.strip()
            if s.startswith(','):
                s = s[1:]
                s = s.strip()
        return acc, s

    def parse_string(self, s, e):
        end = s.find('"', 1)
        while end != -1 and s[end - 1] == '\\':  # Handle escaped quotes
            end = s.find('"', end + 1)
        if end == -1:
            # Incomplete string: handle it based on strict mode
            if not self.strict:
                return s[1:], ""
            else:
                return json.loads(f'"{s[1:]}"'), ""
        str_val = s[:end + 1]
        s = s[end + 1:]
        if not self.strict:
            return str_val[1:-1], s  # Remove surrounding quotes for strict mode
        return json.loads(str_val), s

    def parse_number(self, s, e):
        i = 0
        while i < len(s) and s[i] in '0123456789.-':
            i += 1
        num_str = s[:i]
        s = s[i:]
        if not num_str or num_str == "-" or num_str == ".":
            return num_str, ""
        try:
            if num_str.endswith('.'):
                num = int(num_str[:-1])
            else:
                num = float(num_str) if '.' in num_str or 'e' in num_str or 'E' in num_str else int(num_str)
        except ValueError:
            raise e
        return num, s

    def parse_true(self, s, e):
        if s.startswith('t') or s.startswith('T'):
            return True, s[4:]
        raise e

    def parse_false(self, s, e):
        if s.startswith('f') or s.startswith('F'):
            return False, s[5:]
        raise e

    def parse_null(self, s, e):
        if s.startswith('n'):
            return None, s[4:]
        raise e