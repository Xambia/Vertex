import httpx
import logging
from supabase import create_client, Client
from config import settings

logger = logging.getLogger(__name__)

# Ensure httpx/postgrest clients work smoothly without SSL certificate bundle errors on Windows
try:
    _original_sync_init = httpx.Client.__init__
    httpx.Client.__init__ = lambda self, *args, **kwargs: _original_sync_init(self, *args, **{**kwargs, 'verify': False})
    _original_async_init = httpx.AsyncClient.__init__
    httpx.AsyncClient.__init__ = lambda self, *args, **kwargs: _original_async_init(self, *args, **{**kwargs, 'verify': False})
except Exception:
    pass

# Initialize singleton clients with fallback
def get_supabase_client(use_service_key: bool = True) -> Client:
    url: str = settings.SUPABASE_URL or "https://placeholder.supabase.co"
    key: str = (
        settings.effective_supabase_service_key if use_service_key else settings.effective_supabase_anon_key
    ) or "placeholder-key"
    try:
        return create_client(url, key)
    except Exception as e:
        logger.warning(f"Failed to create Supabase client: {e}")
        return create_client("https://placeholder.supabase.co", "placeholder-key")

supabase_anon: Client = get_supabase_client(use_service_key=False)
supabase_service: Client = get_supabase_client(use_service_key=True)

async def seed_admin_user():
    if not settings.ADMIN_EMAIL or not settings.ADMIN_PASSWORD:
        logger.info("Admin seeding skipped: ADMIN_EMAIL or ADMIN_PASSWORD not set.")
        return

    try:
        # Try to sign in to check if the user exists
        try:
            supabase_anon.auth.sign_in_with_password({
                "email": settings.ADMIN_EMAIL,
                "password": settings.ADMIN_PASSWORD
            })
            logger.info("Admin user already exists.")
            return
        except Exception:
            pass  # Expected if user doesn't exist
            
        # Create user via admin API
        supabase_service.auth.admin.create_user({
            "email": settings.ADMIN_EMAIL,
            "password": settings.ADMIN_PASSWORD,
            "email_confirm": True,
            "user_metadata": {"role": "admin"}
        })
        logger.info("Admin user seeded successfully.")
    except Exception as e:
        logger.warning(f"Skipping admin seed - database unreachable: {e}")
