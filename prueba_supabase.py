import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_SECRET_KEY")

if not url or not key:
    raise Exception("Faltan las variables de Supabase")

supabase = create_client(url, key)

print("Conectado a Supabase.")

datos = {
    "name": "John Test",
    "phone": "9545551234",
    "email": "john.test@example.com",
    "service": "Shower Enclosure",
    "message": "This is a test quote from Python."
}

response = (
    supabase
    .table("quotes")
    .insert(datos)
    .execute()
)

print("Cotizacion insertada correctamente.")
print(response.data)