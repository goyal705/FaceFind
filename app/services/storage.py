"""
Storage service — supports local disk and Cloudinary.
Set STORAGE_TYPE=cloudinary in .env to use Cloudinary.
"""
import os, io, uuid
from app.core.config import settings


def _cloudinary():
    """Lazy import + configure cloudinary only when needed."""
    import cloudinary
    import cloudinary.uploader
    cloudinary.config(
        cloud_name=settings.CLOUDINARY_CLOUD_NAME,
        api_key=settings.CLOUDINARY_API_KEY,
        api_secret=settings.CLOUDINARY_API_SECRET,
        secure=True,
    )
    return cloudinary.uploader


async def upload_file(content: bytes, original_filename: str, event_id: int) -> dict:
    """
    Upload file bytes to the configured storage backend.
    Returns: { "storage_path": str, "url": str }
      - storage_path  → local file path  OR  Cloudinary public_id
      - url           → public HTTP URL to serve to browser / audience
    """
    ext = original_filename.rsplit(".", 1)[-1].lower() if "." in original_filename else "jpg"
    unique_name = uuid.uuid4().hex

    if settings.STORAGE_TYPE == "cloudinary":
        return await _upload_cloudinary(content, ext, event_id, unique_name)
    else:
        return await _upload_local(content, ext, event_id, unique_name)


async def _upload_cloudinary(content: bytes, ext: str, event_id: int, unique_name: str) -> dict:
    uploader = _cloudinary()
    folder = f"facefind/event_{event_id}"
    public_id = f"{folder}/{unique_name}"

    import asyncio
    result = await asyncio.get_event_loop().run_in_executor(
        None,
        lambda: uploader.upload(
            io.BytesIO(content),
            public_id=public_id,
            resource_type="image",
            format=ext,
            overwrite=False,
            # transformation=[{"quality": "auto", "fetch_format": "auto"}],
        )
    )
    
    secure_url = result["secure_url"]
    enhanced_url = secure_url.replace("/upload/", "/upload/e_auto_enhance,f_auto,q_auto/")
    
    return {
        "storage_path": result["public_id"],
        "url": enhanced_url,
    }


async def _upload_local(content: bytes, ext: str, event_id: int, unique_name: str) -> dict:
    import aiofiles
    folder = os.path.join(settings.UPLOAD_DIR, str(event_id))
    os.makedirs(folder, exist_ok=True)
    fname = f"{unique_name}.{ext}"
    fpath = os.path.join(folder, fname)
    async with aiofiles.open(fpath, "wb") as f:
        await f.write(content)
    return {
        "storage_path": fpath,
        "url": f"/api/photos/file/{event_id}/{fname}",
    }


async def delete_file(storage_path: str) -> bool:
    """Delete a file from whichever backend stored it."""
    if settings.STORAGE_TYPE == "cloudinary":
        import asyncio, cloudinary.uploader
        _cloudinary() 
        await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: cloudinary.uploader.destroy(storage_path, resource_type="image")
        )
    else:
        if os.path.exists(storage_path):
            os.remove(storage_path)
    return True