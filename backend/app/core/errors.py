"""Global catch-all so unhandled exceptions still get a CORS-decorated 500.

Starlette's built-in ``ServerErrorMiddleware`` sits OUTSIDE every piece of
user middleware (CORS included), so a genuinely unhandled exception is
turned into a bare 500 that never passes back out through
``CORSMiddleware``. The browser then reports it as a CORS failure
("No 'Access-Control-Allow-Origin' header"), masking the real server-side
fault — which is exactly how a 500 in an API handler ends up *looking*
like a CORS problem.

This middleware is installed INSIDE CORS (added just before it in
``main.py``, so CORS stays the outermost layer). It catches anything the
inner stack raises, logs it with a traceback, reports it to Sentry when
configured, and returns a JSON 500. Because that response is produced
*inside* CORS, the CORS layer decorates it on the way out and the browser
sees a real 500 with the expected headers instead of a phantom CORS error.
"""

from __future__ import annotations

from typing import Any

import structlog
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

_log = structlog.get_logger("rufaqaa.errors")


class CatchAllExceptionMiddleware(BaseHTTPMiddleware):
    """Convert any unhandled exception into a JSON 500 *inside* the CORS
    layer, so error responses carry CORS headers like every other response.

    Registered ``HTTPException`` handlers (404/401/403/…) are resolved by
    Starlette's inner ``ExceptionMiddleware`` and arrive here as ordinary
    responses, so this only ever fires for truly unexpected faults.
    """

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Any:
        try:
            return await call_next(request)
        except Exception:
            _log.exception(
                "unhandled_exception",
                method=request.method,
                path=request.url.path,
            )
            # Best-effort Sentry capture — the default ServerErrorMiddleware
            # would normally report this, but we intercept before it runs.
            try:
                import sentry_sdk

                sentry_sdk.capture_exception()
            except Exception:  # pragma: no cover - Sentry optional / not installed
                pass
            return JSONResponse(
                status_code=500,
                content={"detail": "Internal Server Error"},
            )
