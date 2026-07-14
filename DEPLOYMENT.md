# Manual Habitat Deployment

- Deployed Git commit hash: `891d5bd`
- Local API on the OpenClaw LXC worked. `ss -ltn | grep ':8787'` showed the backend listening on `0.0.0.0:8787`, and `curl http://127.0.0.1:8787/registration` returned the existing Habitat registration JSON instead of `null`.
- The laptop CLI reached the OpenClaw LXC through Tailscale. A laptop request to `curl http://100.70.233.87:8787/registration` returned the same registration JSON, and `habitat status` on the laptop succeeded after setting `HABITAT_API_BASE_URL=http://100.70.233.87:8787`.
- Request logs observed on the OpenClaw server when the laptop ran `habitat status` included:
  - `[kepler] GET /habitats/habitat_d64fd3c9_099b_4afd_bba9_ed8d383b1d5f/registration -> 200`
  - `[habitat-api] GET /status -> registered`
- After stopping the manual backend process, the laptop CLI failed with: `Unable to reach the local Habitat API at http://100.70.233.87:8787. Start it with: bun run server`
- `0.0.0.0` is required for remote access because it tells the backend to listen on every network interface on the server instead of only localhost. That allows requests arriving through the Tailscale interface to reach port `8787`.
- `.env` and `habitat.sqlite` remain inside the deployed checkout because the backend needs the environment configuration and local Habitat state at runtime, but both files are ignored by Git so credentials and private state are never committed to the repository.
