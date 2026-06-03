# ColaAI Canvas Video Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first complete ColaAI canvas video-generation loop using Agnes Video V2.0.

**Architecture:** Add a focused Agnes video protocol module, route video jobs through the existing image-task worker infrastructure as `mode: "video"`, and extend the canvas metadata/task routing so config nodes can switch to video mode and create playable video nodes. The browser continues to call the app backend only; Agnes API keys remain server-side.

**Tech Stack:** Python/FastAPI/Pydantic/curl_cffi for backend API and workers; React/TypeScript/Bun tests for the ColaAI canvas frontend.

---

## File Structure

- Create `services/protocol/agnes_ai_video.py`: Agnes Video V2.0 payload creation, key-rotated create/poll requests, status normalization, and OpenAI-style task result conversion.
- Create `test/test_agnes_ai_video.py`: backend unit tests for payloads, polling, retry behavior, and errors.
- Modify `services/image_task_service.py`: add video job submission, public task fields, mode cleaning, handler dispatch, and log labels.
- Modify `api/image_tasks.py`: add `POST /api/image-tasks/videos` using the existing auth, content filter, queue, and task list flow.
- Modify `web/src/lib/api.ts`: add video task types and `createVideoGenerationTask`.
- Modify `web/src/app/ColaAI/components/canvas-types.ts`: add video metadata fields and generation mode.
- Modify `web/src/app/ColaAI/components/canvas-workflow.ts`: collect `generationMode` and preserve video settings from config nodes.
- Modify `web/src/app/ColaAI/components/canvas-generation-tasks.ts`: route video mode to the video endpoint.
- Modify `web/src/app/ColaAI/components/use-canvas-store.ts`: append/update video nodes and normalize video metadata.
- Modify `web/src/app/ColaAI/components/canvas-node.tsx`: enable Video tab in config nodes and render playable video nodes.
- Modify `web/src/app/ColaAI/components/canvas-generation-panel.tsx`: expose video mode in the floating generation panel.
- Modify `web/src/app/ColaAI/components/canvas-workspace.tsx`: derive `videoUrl` from task polling and update video nodes.
- Update existing focused tests under `web/src/app/ColaAI/components/*.test.*`.

---

### Task 1: Agnes Video Protocol

**Files:**
- Create: `services/protocol/agnes_ai_video.py`
- Test: `test/test_agnes_ai_video.py`

- [ ] **Step 1: Write failing protocol tests**

Add tests that call these intended APIs:

```python
from services.protocol import agnes_ai_video

def test_builds_text_to_video_payload():
    payload = agnes_ai_video.build_agnes_video_payload(
        agnes_ai_video.AgnesVideoRequest(prompt="A cat walks", size="16:9")
    )
    assert payload["model"] == "agnes-video-v2.0"
    assert payload["prompt"] == "A cat walks"
    assert payload["width"] == 1152
    assert payload["height"] == 768
    assert payload["num_frames"] == 121
    assert payload["frame_rate"] == 24

def test_builds_multi_image_video_payload():
    payload = agnes_ai_video.build_agnes_video_payload(
        agnes_ai_video.AgnesVideoRequest(
            prompt="Smooth transition",
            image_urls=["https://example.test/a.png", "https://example.test/b.png"],
        )
    )
    assert payload["extra_body"] == {"image": ["https://example.test/a.png", "https://example.test/b.png"]}
    assert "image" not in payload
```

Also test completed polling returns `{"data": [{"video_url": "...", "url": "..."}]}` and failed polling raises `AgnesAIVideoError`.

- [ ] **Step 2: Run backend video tests and verify failure**

Run: `python -m pytest test/test_agnes_ai_video.py -q`

Expected: FAIL because `services.protocol.agnes_ai_video` does not exist.

- [ ] **Step 3: Implement Agnes video module**

Implement:

```python
AGNES_VIDEO_MODEL = "agnes-video-v2.0"
@dataclass(frozen=True)
class AgnesVideoRequest:
    prompt: str
    size: str | None = None
    image_urls: list[str] = field(default_factory=list)
    num_frames: int = 121
    frame_rate: int = 24
```

Map ratios to dimensions, reject empty prompts and non-public image URLs, create tasks with `POST {base_url}/videos`, poll `GET {base_url}/videos/{task_id}` until completion, and rotate enabled Agnes keys on retryable status codes.

- [ ] **Step 4: Run backend video tests and verify pass**

Run: `python -m pytest test/test_agnes_ai_video.py -q`

Expected: PASS.

---

### Task 2: Backend Video Task Queue Endpoint

**Files:**
- Modify: `services/image_task_service.py`
- Modify: `api/image_tasks.py`
- Test: `test/test_agnes_ai_video.py` or a new focused API/service test if needed.

- [ ] **Step 1: Write failing queue tests**

Add tests proving:

- `ImageTaskService.submit_video(...)` stores `mode: "video"` and returns a public task with `media_type: "video"`.
- A completed video handler result keeps `video_url` in `task["data"][0]`.
- `/api/image-tasks/videos` accepts `client_task_id`, `prompt`, `model`, `size`, and `reference_image_urls`.

- [ ] **Step 2: Run queue tests and verify failure**

Run: `python -m pytest test/test_agnes_ai_video.py -q`

Expected: FAIL because `submit_video` and the route do not exist.

- [ ] **Step 3: Implement service and route**

Add `video_handler` dependency to `ImageTaskService`, `submit_video(...)`, `mode == "video"` dispatch in `_run_task`, `media_type` preservation in `_public_task`, and an API route:

```python
@router.post("/api/image-tasks/videos")
async def create_video_task(body: VideoGenerationTaskRequest, request: Request, authorization: str | None = Header(default=None)):
    ...
```

The route should use `image_task_service.submit_video(...)` and acquire usage limits with `model=body.model`.

- [ ] **Step 4: Run backend tests and verify pass**

Run: `python -m pytest test/test_agnes_ai_video.py test/test_image_tasks_api.py -q`

Expected: PASS or existing unrelated failures clearly identified.

---

### Task 3: Frontend Types and Task Routing

**Files:**
- Modify: `web/src/lib/api.ts`
- Modify: `web/src/app/ColaAI/components/canvas-types.ts`
- Modify: `web/src/app/ColaAI/components/canvas-workflow.ts`
- Modify: `web/src/app/ColaAI/components/canvas-generation-tasks.ts`
- Test: `web/src/app/ColaAI/components/canvas-generation-tasks.test.ts`
- Test: `web/src/app/ColaAI/components/canvas-workflow.test.ts`

- [ ] **Step 1: Write failing frontend routing tests**

Add tests proving video mode routes to `createVideoGenerationTask` with:

```ts
{
  prompt: "生成一段视频",
  model: "agnes-video-v2.0",
  size: "16:9",
  referenceImageUrls: ["https://example.test/reference.png"]
}
```

Also test `collectCanvasGenerationSettings` returns `generationMode: "video"` from a config node.

- [ ] **Step 2: Run focused Bun tests and verify failure**

Run: `cd web; bun test src/app/ColaAI/components/canvas-generation-tasks.test.ts src/app/ColaAI/components/canvas-workflow.test.ts`

Expected: FAIL because video mode fields and route do not exist.

- [ ] **Step 3: Implement types and routing**

Add `VideoModel = "agnes-video-v2.0"`, `createVideoGenerationTask(...)`, `ImageTask.media_type`, `ImageTask.data[].video_url`, metadata fields `generationMode`, `mediaType`, and `videoUrl`, and branch `createCanvasGenerationTasks` on `settings.generationMode === "video"`.

- [ ] **Step 4: Run focused Bun tests and verify pass**

Run: `cd web; bun test src/app/ColaAI/components/canvas-generation-tasks.test.ts src/app/ColaAI/components/canvas-workflow.test.ts`

Expected: PASS.

---

### Task 4: Canvas Store and Workspace Video Nodes

**Files:**
- Modify: `web/src/app/ColaAI/components/use-canvas-store.ts`
- Modify: `web/src/app/ColaAI/components/canvas-workspace.tsx`
- Test: `web/src/app/ColaAI/components/use-canvas-store.test.ts`
- Test: `web/src/app/ColaAI/components/canvas-workspace.test.tsx`

- [ ] **Step 1: Write failing canvas state tests**

Add tests proving:

- `appendGenerationNode` or a new `appendVideoNode` creates `type: "video"` when payload `mediaType` is `"video"`.
- Polling updates a video task with `videoUrl`.
- Retry preserves video mode/model for video nodes.

- [ ] **Step 2: Run focused Bun tests and verify failure**

Run: `cd web; bun test src/app/ColaAI/components/use-canvas-store.test.ts src/app/ColaAI/components/canvas-workspace.test.tsx`

Expected: FAIL because video nodes are still placeholders.

- [ ] **Step 3: Implement store and workspace updates**

Extend payload handling with `mediaType`, `videoUrl`, and route `imageUrlFromTask` equivalent logic through a new helper that returns media URLs for image/video tasks. Keep existing image behavior unchanged.

- [ ] **Step 4: Run focused Bun tests and verify pass**

Run: `cd web; bun test src/app/ColaAI/components/use-canvas-store.test.ts src/app/ColaAI/components/canvas-workspace.test.tsx`

Expected: PASS.

---

### Task 5: Canvas UI Video Mode and Playback

**Files:**
- Modify: `web/src/app/ColaAI/components/canvas-node.tsx`
- Modify: `web/src/app/ColaAI/components/canvas-generation-panel.tsx`
- Test: `web/src/app/ColaAI/components/canvas-workspace.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Add tests proving:

- Config node Video tab is enabled and sets `generationMode: "video"` plus `model: "agnes-video-v2.0"`.
- A successful video node renders a `<video controls>` element using `metadata.videoUrl`.
- Floating generation panel can switch to video mode.

- [ ] **Step 2: Run UI tests and verify failure**

Run: `cd web; bun test src/app/ColaAI/components/canvas-workspace.test.tsx`

Expected: FAIL because the UI still disables video mode.

- [ ] **Step 3: Implement UI**

Enable the Video segmented buttons, keep image mode default, set video model when switching to video, show video-specific labels/count copy, and render successful video nodes with native controls.

- [ ] **Step 4: Run UI tests and verify pass**

Run: `cd web; bun test src/app/ColaAI/components/canvas-workspace.test.tsx`

Expected: PASS.

---

### Task 6: Final Verification

**Files:**
- No new files unless verification exposes required fixes.

- [ ] **Step 1: Run backend focused tests**

Run: `python -m pytest test/test_agnes_ai_video.py test/test_agnes_ai_image.py test/test_image_tasks_api.py test/test_config.py -q`

Expected: PASS or only pre-existing unrelated failures documented with evidence.

- [ ] **Step 2: Run frontend focused tests**

Run: `cd web; bun test src/app/ColaAI/components/canvas-generation-tasks.test.ts src/app/ColaAI/components/canvas-workflow.test.ts src/app/ColaAI/components/use-canvas-store.test.ts src/app/ColaAI/components/canvas-workspace.test.tsx`

Expected: PASS.

- [ ] **Step 3: Browser verification**

Open `http://localhost:3000/ColaAI/`, confirm the config node Video tab is clickable, selecting it shows `agnes-video-v2.0`, and a mocked/failed submit creates a visible loading/error video node without breaking image mode.

- [ ] **Step 4: Completion summary**

Summarize changed files, tests run, and any remaining external dependency caveat such as not having a real Agnes API key for live generation.

---

## Self-Review Notes

- Spec coverage: backend Agnes contract, task queue, frontend routing, canvas video nodes, UI mode switch, error handling, and verification are covered by Tasks 1-6.
- Scope check: settings page model detection and advanced keyframes are intentionally excluded per the spec.
- Type consistency: use `generationMode`, `mediaType`, and `videoUrl` consistently across frontend metadata and task payloads.
