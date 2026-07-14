# Manual Habitat Deployment

- Deployed Git commit hash: `15564f0`
- The API worked locally on the OpenClaw LXC. The server was started with `bun run server`, the listener check showed the backend bound for remote access, and a local `curl` request to `/registration` returned the Habitat registration payload instead of `null`.
- The laptop CLI reached the OpenClaw LXC through Tailscale. After setting `HABITAT_API_BASE_URL` to the deployed backend URL, `habitat status` succeeded from the laptop and returned the normal registration output.
- Request log lines observed on the OpenClaw server when the laptop ran `habitat status` included:
  - `[habitat-api] GET /registration -> registered`
  - `[kepler] GET /habitats/.../registration -> 200`
  - `[habitat-api] GET /status -> registered`
- After stopping the manual server process, the laptop CLI failed to connect and reported: `Unable to reach the local Habitat API ... Start it with: bun run server`
- `0.0.0.0` is required for remote access because it tells the backend to listen on all network interfaces on the server instead of only localhost, which allows requests from another machine to reach the service.
- `.env` and `habitat.sqlite` remain in the checkout because the deployed backend needs local configuration and local Habitat state at runtime, but both files stay ignored by Git so secrets and private state are not committed.
