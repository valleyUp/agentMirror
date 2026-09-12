#!/usr/bin/env sh
set -eu

mirror_base='__NODE_MIRROR_BASE_URL__'
node_version='__NODE_VERSION__'
archive_name='__NODE_LINUX_X64_FILENAME__'
expected_sha256='__NODE_LINUX_X64_SHA256__'

fail() {
  printf 'Node.js installation failed: %s\n' "$*" >&2
  exit 1
}

[ "$(uname -s)" = 'Linux' ] || fail 'this installer supports Linux only'
case "$(uname -m)" in
  x86_64|amd64) ;;
  *) fail 'this installer supports x86_64 only' ;;
esac
if command -v ldd >/dev/null 2>&1; then
  ldd_version=$(ldd --version 2>&1 || true)
  case "$ldd_version" in *musl*) fail 'this Node.js archive requires glibc; download a musl build instead' ;; esac
fi
case "${HOME:-}" in ''|/) fail 'HOME must identify a user directory' ;; esac
command -v sha256sum >/dev/null 2>&1 || fail 'sha256sum is required'
command -v tar >/dev/null 2>&1 || fail 'tar is required'

umask 077
download_dir=$(mktemp -d "${TMPDIR:-/tmp}/agent-mirror-node.XXXXXX") || fail 'cannot create a temporary directory'
versions_dir="$HOME/.local/share/node/versions"
target_dir="$versions_dir/v$node_version"
stage_dir=''
backup_dir=''
cleanup() {
  rm -rf "$download_dir"
  [ -z "$stage_dir" ] || rm -rf "$stage_dir"
  if [ -n "$backup_dir" ] && [ -e "$backup_dir" ] && [ ! -e "$target_dir" ]; then mv "$backup_dir" "$target_dir"; fi
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

archive="$download_dir/$archive_name"
url="$mirror_base/$archive_name"
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$url" -o "$archive" || fail "cannot download $url"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "$archive" "$url" || fail "cannot download $url"
else
  fail 'curl or wget is required'
fi

actual_sha256=$(sha256sum "$archive" | awk '{print $1}')
[ "$actual_sha256" = "$expected_sha256" ] || fail 'download checksum does not match the mirror catalog'

mkdir -p "$versions_dir"
stage_dir=$(mktemp -d "$versions_dir/.v$node_version.install.XXXXXX") || fail 'cannot create the installation directory'
tar -xJf "$archive" -C "$stage_dir" --strip-components=1 || fail 'cannot extract the Node.js archive'
[ -x "$stage_dir/bin/node" ] || fail 'the archive does not contain an executable node binary'
[ "$("$stage_dir/bin/node" --version)" = "v$node_version" ] || fail 'the extracted node binary has the wrong version'
npm_cli="$stage_dir/lib/node_modules/npm/bin/npm-cli.js"
[ -f "$npm_cli" ] || fail 'the archive does not contain npm'
npm_version=$("$stage_dir/bin/node" "$npm_cli" --version)
for name in node npm npx corepack; do
  [ -e "$stage_dir/bin/$name" ] || [ -L "$stage_dir/bin/$name" ] || fail "the archive does not contain bin/$name"
done

if [ -e "$target_dir" ] || [ -L "$target_dir" ]; then
  backup_dir="$versions_dir/.v$node_version.backup.$$"
  [ ! -e "$backup_dir" ] && [ ! -L "$backup_dir" ] || fail 'a stale installation backup already exists'
  mv "$target_dir" "$backup_dir"
fi
mv "$stage_dir" "$target_dir"
stage_dir=''
if [ -n "$backup_dir" ]; then rm -rf "$backup_dir"; backup_dir=''; fi

bin_dir="$HOME/.local/bin"
mkdir -p "$bin_dir"
for name in node npm npx corepack; do
  destination="$bin_dir/$name"
  if { [ -e "$destination" ] || [ -L "$destination" ]; } && [ ! -L "$destination" ]; then
    fail "$destination already exists and is not a symbolic link"
  fi
done
for name in node npm npx corepack; do
  destination="$bin_dir/$name"
  temporary="$bin_dir/.$name.agent-mirror.$$"
  rm -f "$temporary"
  ln -s "$target_dir/bin/$name" "$temporary"
  mv -Tf "$temporary" "$destination"
done

profile_line='export PATH="$HOME/.local/bin:$PATH"'
profile="$HOME/.profile"
if ! [ -f "$profile" ] || ! grep -Fqx "$profile_line" "$profile"; then
  printf '\n%s\n' "$profile_line" >> "$profile"
fi

printf 'Node.js v%s and npm %s installed in %s\n' "$node_version" "$npm_version" "$target_dir"
printf 'npm global commands use <prefix>/bin; tool installation on this mirror uses --prefix "$HOME/.local".\n'
printf 'Open a new shell or run: %s\n' "$profile_line"
