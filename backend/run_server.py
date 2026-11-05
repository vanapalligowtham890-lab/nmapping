import sys
import os

# Add backend directory to sys.path
backend_dir = os.path.dirname(os.path.abspath(__file__))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

import uvicorn

if __name__ == "__main__":
    print("================================================================")
    print("Starting Smart Traffic Routing API & Live Operations Dashboard...")
    print("API Documentation: http://127.0.0.1:8000/docs")
    print("Live Web Dashboard: http://127.0.0.1:8000/")
    print("================================================================")
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=False)
