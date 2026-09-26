import os
from typing import List, Optional
from pathlib import Path
from pydantic_settings import BaseSettings

BASE_DIR = Path(__file__).resolve().parent

class Settings(BaseSettings):
    # Required with safe fallbacks
    FIRMS_MAP_KEY: str = ""
    SUPABASE_URL: str = "https://placeholder.supabase.co"
    SUPABASE_ANON_KEY: str = ""
    SUPABASE_SERVICE_KEY: Optional[str] = None
    SUPABASE_SERVICE_ROLE_KEY: Optional[str] = None
    SUPABASE_KEY: Optional[str] = None
    GEMINI_API_KEY: str = ""

    # Optional Earth Observation APIs
    EARTHDATA_USER: Optional[str] = None
    EARTHDATA_PASS: Optional[str] = None
    CDSE_CLIENT_ID: Optional[str] = None
    CDSE_CLIENT_SECRET: Optional[str] = None

    # App Config
    APP_ENV: str = "development"
    CORS_ORIGINS: str = "*"
    BACKEND_PORT: int = 8000
    AI_CLASSIFICATION_LIMIT: int = 5000
    GEMINI_MODEL: str = "gemini-3.5-flash-lite"

    # Admin Seeding
    ADMIN_EMAIL: str = "admin@example.com"
    ADMIN_PASSWORD: str = "admin123"

    @property
    def effective_supabase_service_key(self) -> str:
        """Returns the service key if available, falling back to service_role_key, key, or anon_key."""
        return (
            self.SUPABASE_SERVICE_KEY
            or self.SUPABASE_SERVICE_ROLE_KEY
            or self.SUPABASE_KEY
            or self.SUPABASE_ANON_KEY
            or ""
        )

    @property
    def effective_supabase_anon_key(self) -> str:
        """Returns the anon key if available, falling back to key or service key."""
        return (
            self.SUPABASE_ANON_KEY
            or self.SUPABASE_KEY
            or self.SUPABASE_SERVICE_KEY
            or self.SUPABASE_SERVICE_ROLE_KEY
            or ""
        )

    @property
    def cors_origins_list(self) -> List[str]:
        """Parse CORS_ORIGINS as comma-separated string into a list."""
        if not self.CORS_ORIGINS or self.CORS_ORIGINS.strip() == "*":
            return ["*"]
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]

    model_config = {
        "env_file": (str(BASE_DIR / ".env"), str(BASE_DIR.parent / ".env")),
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }

settings = Settings()
