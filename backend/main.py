from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
import logging
from config import settings
from limiter import limiter

from routers import health, firms, osm, hotspots, analytics, satellite
from db.supabase_client import supabase_anon, seed_admin_user
from jobs.scheduler import start_scheduler, stop_scheduler

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="VERTEX API",
    description="AI-based industrial fire detection platform for SIH 26162",
    version="1.0.0"
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(GZipMiddleware, minimum_size=1000)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health", tags=["Health"], include_in_schema=False)
@app.get("/health/", tags=["Health"])
async def root_health_check(response: Response = None):
    return await health.health_check(response)

# Include routers
app.include_router(health.router, prefix="/api/v1")
app.include_router(firms.router, prefix="/api/v1")
app.include_router(osm.router, prefix="/api/v1")
app.include_router(hotspots.router, prefix="/api/v1")
app.include_router(analytics.router, prefix="/api/v1")
app.include_router(satellite.router, prefix="/api/v1")

@app.on_event("startup")
async def startup_event():
    logger.info("Starting VERTEX API...")
    logger.info("Validating settings...")
    
    if not settings.FIRMS_MAP_KEY:
        logger.warning("FIRMS_MAP_KEY is missing; real-time NASA FIRMS calls may fail.")
    if not settings.SUPABASE_URL or not settings.effective_supabase_service_key:
        logger.warning("Supabase credentials missing or incomplete; operating in degraded mode.")
    if not settings.GEMINI_API_KEY:
        logger.warning("GEMINI_API_KEY is missing; AI classification will use expert rule fallbacks.")
    
    logger.info(f"EARTHDATA credentials present: {bool(settings.EARTHDATA_USER)}")
    logger.info(f"CDSE credentials present: {bool(settings.CDSE_CLIENT_ID)}")
    
    # Simple Supabase connection check
    try:
        supabase_anon.table("hotspots").select("id").limit(1).execute()
        logger.info("Supabase connection initialized successfully.")
    except Exception as e:
        logger.warning(f"Could not reach Supabase tables on startup (ignoring): {e}")

    # Seed Admin User
    try:
        await seed_admin_user()
    except Exception as e:
        logger.warning(f"Admin seed skipped on startup: {e}")
    
    # Start Scheduler
    try:
        start_scheduler()
    except Exception as e:
        logger.warning(f"Scheduler start skipped on startup: {e}")

@app.on_event("shutdown")
async def shutdown_event():
    logger.info("Shutting down VERTEX API...")
    try:
        stop_scheduler()
    except Exception:
        pass
