# Build an exact committed revision, without copying untracked runtime data.
[CmdletBinding()]
param(
    [string]$Ref = 'HEAD',
    [switch]$SkipTests
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$sha = (git -C $repo rev-parse --verify "$Ref^{commit}").Trim()
if ($LASTEXITCODE -ne 0 -or $sha -notmatch '^[a-f0-9]{40}$') {
    throw 'A valid committed Git revision is required.'
}
$tag = "foldergram-local/foldergram:git-$($sha.Substring(0,12))"
$context = Join-Path ([IO.Path]::GetTempPath()) ("foldergram-build-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $context | Out-Null
$archive = Join-Path $context 'source.tar'
$source = Join-Path $context 'source'
try {
    New-Item -ItemType Directory -Path $source | Out-Null
    git -C $repo archive --format=tar "--output=$archive" $sha
    if ($LASTEXITCODE -ne 0) { throw 'Git archive failed.' }
    tar -xf $archive -C $source
    if ($LASTEXITCODE -ne 0) { throw 'Archive extraction failed.' }
    $dockerfile = Join-Path $source 'Dockerfile.photography'
    if (!(Test-Path -LiteralPath $dockerfile)) { throw 'Selected revision lacks the photography Dockerfile.' }
    $common = @('--progress','plain','--file',$dockerfile,'--build-arg',"SOURCE_REVISION=$sha")
    if (!$SkipTests) {
        docker buildx build @common --target verify --output type=cacheonly $source
        if ($LASTEXITCODE -ne 0) { throw 'Verification failed; no runtime image released.' }
    }
    docker buildx build @common --target runtime --load --tag $tag $source
    if ($LASTEXITCODE -ne 0) { throw 'Runtime image build failed.' }
    $label = docker image inspect $tag --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'
    if ($LASTEXITCODE -ne 0 -or "$label".Trim() -ne $sha) { throw 'Built image revision label mismatch.' }
    Write-Output "Built $tag from $sha"
} finally {
    if (Test-Path -LiteralPath $context) {
        Remove-Item -LiteralPath $context -Recurse -Force
    }
}
