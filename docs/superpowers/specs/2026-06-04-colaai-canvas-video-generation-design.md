# ColaAI Canvas Video Generation Design

## Goal

Add a first usable video-generation loop inside the ColaAI canvas. A user should be able to switch a config node to Video, use the Agnes video model, submit a canvas workflow, and receive a playable video node back on the canvas with the same task status behavior used by image generation.

## Scope

The first version supports text-to-video, image-to-video, and multi-image video through the existing canvas upstream chain:

- Text and config prompt content become the Agnes video `prompt`.
- One upstream image becomes `image`.
- Multiple upstream images become `extra_body.image`.
- The video model is `agnes-video-v2.0` and lives in the config node's Video tab.
- Default video parameters are `num_frames: 121` and `frame_rate: 24`.
- Canvas ratio choices map to Agnes `width` and `height`.

This version does not add advanced keyframe controls, seed editing, pricing display, or a redesigned Agnes settings page. Those can be layered on after the basic loop is stable.

## Architecture

The implementation extends the current task flow instead of creating a separate front-end runtime. The browser never talks directly to Agnes, so API keys stay server-side.

Backend:

- Add an Agnes video protocol module beside the existing Agnes image module.
- Reuse the configured `agnes_ai.base_url` and enabled key rotation.
- Create video tasks with `POST /videos`.
- Poll video tasks with `GET /videos/{task_id}` until `completed`, `failed`, or timeout.
- Return a normal task object that includes `media_type: "video"` and `video_url` on success.

Frontend:

- Extend canvas metadata with `mediaType`, `videoUrl`, and `generationMode`.
- Enable the config node's Video tab and store the selected mode in node metadata.
- Show `agnes-video-v2.0` as the active model for video mode.
- Route video-mode submissions to the video task endpoint.
- Append a `video` node for video results and render it with native controls.

## Data Flow

1. The user selects a config node and switches it from Image to Video.
2. The config node stores `generationMode: "video"` and `model: "agnes-video-v2.0"`.
3. On submit, canvas workflow collection gathers prompt text and upstream image URLs.
4. The frontend creates one video task and immediately appends a loading video node.
5. The task worker submits to Agnes and polls the Agnes task result.
6. Polling updates the canvas node from loading to success or error.
7. On success, the node stores and renders `metadata.videoUrl`.

## Agnes Contract

The Agnes Video V2.0 documentation exposes an async task API:

- Create: `POST https://apihub.agnes-ai.com/v1/videos`
- Retrieve: `GET https://apihub.agnes-ai.com/v1/videos/{task_id}`
- Model: `agnes-video-v2.0`
- Completed result includes `status: "completed"` and `video_url`.

Text-to-video payload:

```json
{
  "model": "agnes-video-v2.0",
  "prompt": "A cinematic shot...",
  "height": 768,
  "width": 1152,
  "num_frames": 121,
  "frame_rate": 24
}
```

Image-to-video adds a public `image` URL. Multi-image video uses `extra_body.image`.

## Error Handling

- Missing prompt returns an error task before contacting Agnes.
- Missing Agnes keys returns the same configured-key error style as Agnes image generation.
- Non-terminal Agnes statuses keep the canvas node loading.
- Failed, cancelled, or timed-out Agnes tasks become canvas error nodes with the upstream message when present.
- Local data URLs are rejected for Agnes image references unless the app can convert them to public URLs before submission.

## Tests

Backend tests:

- Build text-to-video payload.
- Build image-to-video payload.
- Build multi-image payload.
- Rotate keys on retryable create/poll failures.
- Poll a completed Agnes video task and expose `video_url`.
- Surface failed Agnes task status as an error.

Frontend tests:

- Config node can store video mode and `agnes-video-v2.0`.
- Canvas workflow returns video generation settings from the config node.
- Canvas task creation routes video mode to video task creation.
- Store appends and updates video nodes with `videoUrl`.
- Node renderer uses a `<video>` preview for successful video nodes.

## Acceptance Criteria

- A config node's Video tab is enabled.
- Selecting Video sets the model to `agnes-video-v2.0`.
- Submitting a video workflow creates a video result node in loading state.
- Successful Agnes completion updates the node with a playable video URL.
- Failed Agnes completion updates the node with a visible error.
- Existing image generation, image edits, upscale, grid split, and retry behavior continue to pass their tests.
