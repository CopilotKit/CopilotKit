from fastapi import FastAPI
from pydantic import BaseModel
from agent import summarize_email

app = FastAPI()

class EmailRequest(BaseModel):
    email_text: str

@app.post("/summarize")
def summarize(req: EmailRequest):
    return summarize_email(req.email_text)
