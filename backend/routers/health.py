import asyncio
from fastapi import APIRouter, Response, status
from config import settings
from services.status import service_status
from db.supabase_client import supabase_service

router = APIRouter(prefix="/health", tags=["Health"])

@router.get("", include_in_schema=False)
@router.get("/")
async def health_check(response: Response = None):
    db_status = "OPERATIONAL"
    db_error = None
    try:
        # Run DB probe in thread with 3.0s timeout to avoid blocking async event loop
        await asyncio.wait_for(
            asyncio.to_thread(lambda: supabase_service.table("hotspots").select("id").limit(1).execute()),
            timeout=3.0
        )
    except Exception as exc:
        db_status = "DEGRADED"
        db_error = str(exc)

    services = {**service_status}
    services["database"] = {"status": db_status, **({"error": db_error} if db_error else {})}
    overall = "operational" if db_status == "OPERATIONAL" and bool(settings.GEMINI_API_KEY) else "degraded"
    
    return {
        "status": overall,
        "services": services,
        "classification_model": settings.GEMINI_MODEL,
        "classification_provider": "Google Gemini",
        "version": "1.0.0"
    }
