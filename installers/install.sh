#!/bin/bash

# Adapted from the Claude Code native bootstrap installer for an internal mirror.
set -euo pipefail

TARGET="${1:-latest}"
if [[ ! "$TARGET" =~ ^(stable|latest|[0-9]+\.[0-9]+\.[0-9]+(-[^[:space:]]+)?)$ ]]; then
    echo "Usage: $0 [stable|latest|VERSION]" >&2
    exit 1
fi

if [ "$(id -u)" -eq 0 ] && [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ] && [ -z "${CLAUDE_INSTALL_ALLOW_SUDO:-}" ]; then
    echo "Do not run this installer with sudo; Claude Code is installed in your home directory." >&2
    exit 1
fi

DOWNLOAD_BASE_URL="__CLAUDE_MIRROR_BASE_URL__"
DOWNLOAD_DIR="${HOME:?HOME is not set}/.claude/downloads"
VERSIONS_DIR="$HOME/.local/share/claude/versions"
BIN_DIR="$HOME/.local/bin"

if command -v curl >/dev/null 2>&1; then
    DOWNLOADER="curl"
elif command -v wget >/dev/null 2>&1; then
    DOWNLOADER="wget"
else
    echo "curl or wget is required." >&2
    exit 1
fi

download_file() {
    local url="$1"
    local output="${2:-}"
    if [ "$DOWNLOADER" = "curl" ]; then
        if [ -n "$output" ]; then curl -fsSL -o "$output" "$url"; else curl -fsSL "$url"; fi
    else
        if [ -n "$output" ]; then wget -q -O "$output" "$url"; else wget -q -O - "$url"; fi
    fi
}

case "$(uname -s)" in
    Darwin) os="darwin" ;;
    Linux) os="linux" ;;
    *) echo "Unsupported operating system: $(uname -s)" >&2; exit 1 ;;
esac
case "$(uname -m)" in
    x86_64|amd64) arch="x64" ;;
    arm64|aarch64) arch="arm64" ;;
    *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac
if [ "$os" = "darwin" ] && [ "$arch" = "x64" ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || true)" = "1" ]; then
    arch="arm64"
fi
if [ "$os" = "linux" ] && { [ -f /lib/libc.musl-x86_64.so.1 ] || [ -f /lib/libc.musl-aarch64.so.1 ] || ldd /bin/ls 2>&1 | grep -q musl; }; then
    platform="linux-${arch}-musl"
else
    platform="${os}-${arch}"
fi

if [ "$TARGET" = "latest" ] || [ "$TARGET" = "stable" ]; then
    version="$(download_file "$DOWNLOAD_BASE_URL/$TARGET")"
else
    version="$TARGET"
fi
version="${version//$'\r'/}"
version="${version//$'\n'/}"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[^[:space:]]+)?$ ]]; then
    echo "The mirror returned an invalid Claude Code version." >&2
    exit 1
fi

manifest_json="$(download_file "$DOWNLOAD_BASE_URL/$version/manifest.json")"
if command -v jq >/dev/null 2>&1; then
    checksum="$(printf '%s' "$manifest_json" | jq -r ".platforms[\"$platform\"].checksum // empty")"
else
    normalized="$(printf '%s' "$manifest_json" | tr -d '\n\r\t' | sed 's/ \+/ /g')"
    if [[ $normalized =~ \"$platform\"[[:space:]]*:[[:space:]]*[{][^{}]*\"checksum\"[[:space:]]*:[[:space:]]*\"([a-f0-9]{64})\" ]]; then
        checksum="${BASH_REMATCH[1]}"
    else
        checksum=""
    fi
fi
if [[ ! "$checksum" =~ ^[a-f0-9]{64}$ ]]; then
    echo "Claude Code $version is not available for $platform in this mirror." >&2
    exit 1
fi

mkdir -p "$DOWNLOAD_DIR" "$VERSIONS_DIR" "$BIN_DIR"
binary_path="$DOWNLOAD_DIR/claude-$version-$platform.$$"
staged_path="$VERSIONS_DIR/.$version.$$.tmp"
launcher_tmp="$BIN_DIR/.claude.$$.tmp"
cleanup() { rm -f "$binary_path" "$staged_path" "$launcher_tmp"; }
trap cleanup EXIT

echo "Downloading Claude Code $version from the internal mirror..."
download_file "$DOWNLOAD_BASE_URL/$version/$platform/claude" "$binary_path"
if [ "$os" = "darwin" ]; then
    actual_checksum="$(shasum -a 256 "$binary_path" | cut -d' ' -f1)"
else
    actual_checksum="$(sha256sum "$binary_path" | cut -d' ' -f1)"
fi
if [ "$actual_checksum" != "$checksum" ]; then
    echo "Checksum verification failed." >&2
    exit 1
fi

cp "$binary_path" "$staged_path"
chmod 755 "$staged_path"
mv -f "$staged_path" "$VERSIONS_DIR/$version"
if [ -d "$BIN_DIR/claude" ] && [ ! -L "$BIN_DIR/claude" ]; then
    echo "$BIN_DIR/claude is a directory and cannot be replaced." >&2
    exit 1
fi
ln -s "$VERSIONS_DIR/$version" "$launcher_tmp"
mv -f "$launcher_tmp" "$BIN_DIR/claude"

echo "Claude Code $version installed at $BIN_DIR/claude"
case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *) echo "Add $BIN_DIR to PATH, then run: claude --version" ;;
esac

