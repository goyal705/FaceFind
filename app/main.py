from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
import os
from fastapi import Request
from fastapi.responses import HTMLResponse
from app.core.config import settings
from app.core.database import create_tables
from app.routers import auth, events, photos, links
from fastapi.templating import Jinja2Templates

templates = Jinja2Templates(directory="app/templates")

@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    await create_tables()
    yield

app = FastAPI(
    title="FaceFind API",
    description="Event photo finder using face recognition",
    version="1.0.0",
    lifespan=lifespan,
)

app.mount("/static", StaticFiles(directory="app/static"), name="static")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # tighten in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router,   prefix="/api")
app.include_router(events.router, prefix="/api")
app.include_router(photos.router, prefix="/api")
app.include_router(links.router,  prefix="/api")

@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "1.0.0"}

@app.get("/", response_class=HTMLResponse)
async def homepage_page(request: Request):
    return templates.TemplateResponse(
        "homepage/homepage.html",
        {"request": request}
    )

@app.get("/admin", response_class=HTMLResponse)
async def admin_page(request: Request):
    return templates.TemplateResponse(
        "admin/index.html",
        {"request": request}
    )

@app.get("/uploader", response_class=HTMLResponse)
async def uploader_page(request: Request, token: str = ""):
    return templates.TemplateResponse(
        "uploader/uploader.html", 
        {
        "request": request,
        "upload_token": token
    })

@app.get("/audience", response_class=HTMLResponse)
async def audience_page(request: Request):
    return templates.TemplateResponse(
        "audience/audience.html",
        {"request": request}
    )