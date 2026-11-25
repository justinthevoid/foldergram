# Photography fork container build

The photography fork is built directly from a Git commit, not from the former sequence of local patch images. The original upstream Dockerfile and release workflow are unchanged.

On Windows, with Git, Docker Desktop and PowerShell available:

```powershell
git switch justin/photography-gallery
git pull --ff-only
./scripts/build-photography.ps1
```

The script builds from a temporary Git archive of the chosen commit, excluding untracked files and local runtime state. It first executes the complete server and client test suite in the verification stage, then builds the runtime stage and tags it `foldergram-local/foldergram:git-<12-character-commit>`. The image contains an OCI revision label with the full SHA. To build an older committed revision containing the Dockerfile, use `-Ref <commit>`. `-SkipTests` is an explicit development-only escape hatch; do not use it for a production release.

The Node base is pinned to its multi-platform manifest digest, pnpm is pinned, and application dependencies use the frozen committed lockfile. FFmpeg and its Debian dependencies are obtained from the distribution repositories; this is a repeatable source build, not a guarantee of byte-identical image digests across time or architectures.

The runtime stage contains only the server's production dependencies, compiled server and client, database migrations, license, and start script. Test and development dependencies remain in the verification/build stages.

## Private deployment

Keep the existing persistent Compose data mounts, environment and family gateway/tunnel configuration. Back up the SQLite database with SQLite's online backup API, record the previous image tag, update only the Foldergram image in the existing local override, and recreate only Foldergram. Check database integrity and unchanged data counts, private authentication, external anonymous denial, the service worker, and health before considering the release complete.

Do not copy the deployment directory into a build context, publish a private configuration, or remove the previous image before validation. Keep at least one known-good rollback image. Never revert to a build lacking publication or draft-policy enforcement while withheld posts or import policies exist. Do not run the upstream public demo deployment workflow for this private instance.

The historical patch directories are retained as deployment records. They are no longer required to build the current fork.
