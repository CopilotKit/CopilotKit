def filter_by_schema_keys(obj, schema):
    try:
        return {
            k: v for k, v in obj.items()
            if k in schema or k == "messages"
        }
    except Exception:
        return obj