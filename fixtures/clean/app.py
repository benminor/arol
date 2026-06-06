from openai import OpenAI

client = OpenAI()

# Legacy openai.ChatCompletion.create() is gone; we use the client now.
def ask(prompt: str):
    return client.chat.completions.create(
        model="gpt-5",
        messages=[{"role": "user", "content": prompt}],
    )
