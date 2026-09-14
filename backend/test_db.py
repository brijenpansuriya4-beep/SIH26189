import asyncio
import os
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

async def test_connection():
    print("Connecting to Supabase...")
    try:
        engine = create_async_engine(DATABASE_URL)
        async with engine.connect() as conn:
            result = await conn.execute(text("SELECT current_database(), now();"))
            db_info = result.fetchone()
            print(" Connection Successful!")
            print(f"Connected to DB: {db_info[0]} at {db_info[1]}")
        await engine.dispose()
    except Exception as e:
        print(" Connection Failed:")
        print(e)

if __name__ == "__main__":
    asyncio.run(test_connection())