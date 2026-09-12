import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_SECRET_KEY")

if not url:
    raise Exception("Falta SUPABASE_URL")

if not key:
    raise Exception("Falta SUPABASE_SECRET_KEY")

supabase = create_client(url, key)

print("SUPABASE: CONEXION INICIALIZADA CORRECTAMENTE")