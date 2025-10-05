from pydantic import BaseModel

class EmailSummary(BaseModel):
    summary: str

def summarize_email(email_text: str) -> EmailSummary:
    sentences = email_text.split(".")
    summary = " • ".join(sent.strip() for sent in sentences[:2] if sent.strip())
    return EmailSummary(summary=summary)
