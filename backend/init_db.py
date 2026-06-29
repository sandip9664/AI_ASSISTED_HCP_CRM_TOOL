import os
from models import engine, Base

print("Connecting to Supabase PostgreSQL instance...")
print(f"Targeting Host: {engine.url.host}")


Base.metadata.create_all(bind=engine)

print("✅ Application tables successfully initialized inside your Supabase project!")