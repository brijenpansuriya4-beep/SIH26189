import os
import json
from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

api_key = os.getenv("GEMINI_API_KEY")

client = None
if api_key:
    try:
        client = genai.Client(api_key=api_key)
    except Exception as err:
        print(f"Failed to initialize Gemini client: {err}")
        client = None

def get_mock_extraction(fir_text: str) -> dict:
    return {
        "case_title": "Interstate Crime Syndicate",
        "nodes": [
            {"id": "node_1", "name": "Rajesh Rocky Bhai", "type": "Suspect", "role": "Syndicate Head", "risk": 9.0},
            {"id": "node_2", "name": "Amit Solanki", "type": "Suspect", "role": "Field Associate", "risk": 6.5},
            {"id": "node_3", "name": "+91-9825012345", "type": "Phone", "role": "Primary Contact", "risk": 4.5},
            {"id": "node_4", "name": "GJ-01-EF-9988", "type": "Vehicle", "role": "Transport Vehicle", "risk": 5.0},
            {"id": "node_5", "name": "SG Highway, Ahmedabad", "type": "Location", "role": "Incident Site", "risk": 3.0}
        ],
        "links": [
            {"source": "node_1", "target": "node_2", "relation": "COORDINATES_WITH"},
            {"source": "node_1", "target": "node_3", "relation": "OPERATES_PHONE"},
            {"source": "node_2", "target": "node_4", "relation": "DRIVES"},
            {"source": "node_2", "target": "node_5", "relation": "OPERATING_NEAR"}
        ]
    }

def extract_entities(fir_text: str) -> dict:
    if not client:
        print("Gemini client not initialized: Falling back to mock extraction.")
        return get_mock_extraction(fir_text)

    prompt = (
        "You are an expert AI crime intelligence analyst.\n"
        "Extract entities, relationships, and a short case title from the provided FIR text.\n"
        "Entity types allowed: Suspect, Phone, Location, Vehicle, Bank Account, Organization.\n"
        "Output MUST be a valid, raw JSON object ONLY.\n"
        "JSON structure requirement:\n"
        "{\n"
        '  "case_title": "Short descriptive title under 6 words",\n'
        '  "nodes": [\n'
        '    {"id": "node_1", "name": "Canonical Identifier", "type": "Suspect|Phone|Location|Vehicle|Bank Account|Organization", "role": "Role description", "risk": 5.0}\n'
        '  ],\n'
        '  "links": [\n'
        '    {"source": "node_1", "target": "node_2", "relation": "RELATION_TYPE"}\n'
        '  ]\n'
        "}\n"
        "Rules: Risk must be between 1.0 and 10.0. Ensure all nodes have unique IDs and links connect valid node IDs.\n\n"
        f"FIR TEXT:\n{fir_text}"
    )

    try:
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.1
            )
        )

        content = response.text.strip()
        data = json.loads(content)

        if isinstance(data, dict) and "nodes" in data and "links" in data and len(data["nodes"]) > 0:
            if "case_title" not in data or not data["case_title"]:
                data["case_title"] = "Uncategorized Crime Case"
            return data

    except Exception as e:
        print(f"Gemini API generation failed: {e}")

    print("Falling back to mock extraction.")
    return get_mock_extraction(fir_text)