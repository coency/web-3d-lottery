#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
base=$PWD
die(){ echo "$*" >&2; exit 1; }
value(){ sed -n "s/^$1=//p" "$2" | tr -d '\r'; }
dc(){ docker compose --env-file "$base/release.env" --env-file "$base/config/compose.env" -f "$base/compose.yaml" "$@"; }
usage(){ echo '用法：sudo bash starlit.sh start|stop|status|logs|backup|reset-password'; echo '恢复到空目录：sudo bash starlit.sh restore /绝对路径/备份目录'; echo '升级：sudo bash starlit.sh upgrade /绝对路径/新版本部署包目录'; echo '清理预览：sudo bash starlit.sh cleanup [--package /新解压目录] [--archive /压缩包.tar.gz | --downloads]'; echo '--downloads：同时检查 /root 中当前版本的源码压缩包及校验文件'; echo '确认清理：在以上命令末尾加 --apply，再按提示输入 CLEAN'; }
action=${1:-help}
case "$action" in help|--help|-h) usage; exit 0;; esac
case "$action" in start|stop|status|logs|backup|reset-password|restore|upgrade|cleanup) ;; *) usage; exit 1;; esac
[[ $(uname -s) == Linux && $(uname -m) == x86_64 && $EUID == 0 ]] || die '请在 Linux x86_64 上使用 sudo 运行。'
command -v flock >/dev/null || die '请安装 util-linux（需要 flock）。'
exec 9> .maintenance.lock
flock -n 9 || die '另一个安装或维护操作正在运行，请稍后重试。'
docker info >/dev/null
docker compose version >/dev/null

verify_tree(){
  local directory=$1 line relative
  [[ -f "$directory/SHA256SUMS" && ! -L "$directory" ]] || die '缺少校验清单或路径不合法。'
  [[ -z $(find "$directory" -mindepth 1 ! -type d ! -type f -print -quit) ]] || die '包内含符号链接或特殊文件，已拒绝。'
  while IFS= read -r line; do
    [[ $line =~ ^[a-f0-9]{64}\ [\ *]\./[a-zA-Z0-9_./@+\ -]+$ ]] || die '校验清单格式不合法。'
    relative=${line:66}
    [[ /$relative/ != *'/../'* ]] || die '校验路径越界。'
  done < "$directory/SHA256SUMS"
  (cd -- "$directory" && sha256sum --check --status SHA256SUMS) || die '文件校验失败，请重新取得完整的包。'
}

images(){
  local directory=$1 app gateway ref
  app=$(value APP_IMAGE "$directory/release.env")
  gateway=$(value GATEWAY_IMAGE "$directory/release.env")
  for ref in "$app" "$gateway"; do
    [[ $ref =~ ^[a-zA-Z0-9][a-zA-Z0-9_./:@-]+$ ]] || die '镜像名称无效。'
  done
  if [[ -f "$directory/images.tar" ]]; then
    verify_tree "$directory"
    docker load -i "$directory/images.tar"
  elif [[ -d "$directory/source" ]]; then
    for ref in "$app" "$gateway"; do
      if ! docker image inspect "$ref" >/dev/null 2>&1; then
        local target=app
        [[ $ref == "$gateway" ]] && target=gateway
        docker build --platform linux/amd64 --target "$target" -t "$ref" -f "$directory/source/deploy/container/Dockerfile" "$directory/source"
      fi
    done
  else
    docker pull "$app"
    docker pull "$gateway"
  fi
  for ref in "$app" "$gateway"; do
    [[ $(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$ref") == linux/amd64 ]] || die '镜像必须为 linux/amd64。'
  done
  docker image inspect public.ecr.aws/docker/library/postgres:18.6-bookworm >/dev/null 2>&1 || docker pull public.ecr.aws/docker/library/postgres:18.6-bookworm
}
current_images(){
  local version
  version=$(value RELEASE_VERSION release.env)
  [[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-z0-9.]+)?$ ]] || die '版本号无效。'
  if [[ -f "$base/releases/$version/release.env" ]]; then
    images "$base/releases/$version"
  else
    images "$base"
  fi
}

directories(){
  install -d -m0750 -o1000 -g1000 data/uploads
  install -d -m0755 -o1000 -g1000 data/verification
  # Match the pinned PostgreSQL bookworm image's postgres uid/gid. Do not
  # recursively rewrite database files; the official entrypoint owns PGDATA.
  install -d -m0700 -o999 -g999 data/postgres
  install -d -m0700 data/caddy data/caddy-config backups
}
database(){
  local container health
  container=$(dc ps -a -q db)
  if [[ -n "$container" ]]; then
    health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container")
    if [[ $health == unhealthy ]]; then
      echo '数据库原容器健康检查失败，保留数据并重建容器后重试一次。'
      dc up -d --force-recreate --wait --wait-timeout 150 db || {
        echo '数据库仍未就绪，请运行 sudo bash starlit.sh logs 查看原因。未删除数据库数据。' >&2
        return 1
      }
      return 0
    fi
  fi
  dc up -d --wait --wait-timeout 150 db
}
migrate(){ dc run --rm --no-deps -T migrate; }
account(){ dc run --rm --no-deps api node scripts/account.mjs "$1"; }
web(){
  # Recreate both services together: gateway shares api's network namespace.
  dc up -d --no-deps --force-recreate --wait --wait-timeout 180 api gateway
  local domain https_error
  domain=$(value APP_DOMAIN config/gateway.env)
  if ! command -v curl >/dev/null; then die '容器已启动，但缺少 curl，无法确认 HTTPS。请安装 curl 后重试 start。'; fi
  echo '正在等待 HTTPS 就绪（首次启动可能需要申请证书，请稍候）…'
  if ! https_error=$(curl --fail --silent --show-error --retry 8 --retry-all-errors --retry-delay 5 --max-time 10 "https://$domain/" -o /dev/null 2>&1); then
    printf '%s\n' "$https_error" | tail -n 1 >&2
    die '容器已启动，HTTPS 检查未通过。请检查域名解析、公网 80/443 端口和 gateway 日志，再运行 start。'
  fi
  echo "网站已启动：https://$domain"
}

backup_path=''
resume_web=0
on_exit(){
  local result=$?
  trap - EXIT
  if [[ $resume_web == 1 ]]; then
    echo '恢复备份前的服务运行状态。'
    dc start api gateway || { echo '服务恢复失败，请执行 start。' >&2; result=1; }
  fi
  exit "$result"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
backup(){
  local keep_stopped=${1:-no} running
  running=$(dc ps --status running --services)
  # Reject half-running states instead of silently changing the original state.
  if grep -qx api <<< "$running" || grep -qx gateway <<< "$running"; then
    grep -qx api <<< "$running" && grep -qx gateway <<< "$running" || die '服务处于部分运行状态，请先 start 或 stop 后再备份。'
    resume_web=1
  fi
  dc stop gateway api
  database
  install -d -m0700 backups
  backup_path=$(mktemp -d "$base/backups/$(date -u +%Y%m%dT%H%M%SZ).XXXXXX")
  echo '备份期间暂停网站写入，正在保存数据库、图片及密钥。'
  touch "$backup_path/INCOMPLETE"
  dc exec -T db pg_dump -U starlit -d starlit -Fc > "$backup_path/database.dump"
  cp -a config "$backup_path/config"
  cp release.env compose.yaml "$backup_path/"
  mkdir "$backup_path/data"
  cp -a data/uploads data/verification data/caddy data/caddy-config "$backup_path/data/"
  rm -- "$backup_path/INCOMPLETE"
  (cd -- "$backup_path" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
  echo "备份完成：$backup_path"
  echo '此目录含登录及微信密钥，请妥善保存并复制到另一台设备。'
  if [[ $keep_stopped == yes ]]; then resume_web=0; fi
}

# Cleanup runs under the same maintenance lock as upgrades and backups. It never
# prunes Docker globally, follows symlinks, or removes arbitrary installation paths.
cleanup_tree(){
  local folder=$1
  [[ -d "$folder" && ! -L "$folder" && $(realpath -e -- "$folder") == "$folder" ]] || return 1
  [[ -z $(find "$folder" -type d -exec mountpoint -q -- {} \; -print -quit) ]] || return 1
  (verify_tree "$folder") >/dev/null 2>&1 || return 1
  # Reject extra files which may be user data, even if the original manifest passes.
  diff -q <(cd -- "$folder" && find . -type f ! -path ./SHA256SUMS -print | LC_ALL=C sort) \
    <(cut -c67- "$folder/SHA256SUMS" | LC_ALL=C sort) >/dev/null
}
# Fresh installs keep their rebuild sources at the installation root, rather
# than releases/<version>. Verify only immutable build inputs: runtime data and
# separately updated maintenance scripts must remain outside this comparison.
cleanup_sources(){
  local folder=$1 line relative release_found=0 compose_found=0 source_count=0
  local -a entries=() source_files=()
  [[ -f "$folder/SHA256SUMS" && ! -L "$folder/SHA256SUMS" && -d "$folder/source" && $(realpath -e -- "$folder/source") == "$folder/source" ]] || return 1
  [[ -f "$folder/source/deploy/container/Dockerfile" && -f "$folder/source/package.json" ]] || return 1
  [[ -z $(find "$folder/source" ! -type d ! -type f -print -quit) ]] || return 1
  while IFS= read -r line; do
    [[ $line =~ ^[a-f0-9]{64}\ [\ *]\./[a-zA-Z0-9_./@+\ -]+$ ]] || return 1
    relative=${line:66}
    [[ /$relative/ != *'/../'* ]] || return 1
    case "$relative" in
      ./release.env) release_found=1;;
      ./compose.yaml) compose_found=1;;
      ./source/*) source_count=$((source_count+1)); source_files+=("$relative");;
      *) continue;;
    esac
    [[ -f "$folder/$relative" && ! -L "$folder/$relative" ]] || return 1
    entries+=("$line")
  done < "$folder/SHA256SUMS"
  (( release_found && compose_found && source_count )) || return 1
  (cd -- "$folder" && printf '%s\n' "${entries[@]}" | sha256sum --check --status) || return 1
  diff -q <(cd -- "$folder" && find ./source -type f -print | LC_ALL=C sort) \
    <(printf '%s\n' "${source_files[@]}" | LC_ALL=C sort) >/dev/null
}
cleanup_archive_source(){
  local version=$1
  if [[ -e "$base/releases/$version" ]]; then cleanup_tree "$base/releases/$version";
  else cleanup_sources "$base"; fi
}
cleanup_ready(){
  local service ids id expected actual domain
  for service in db api gateway; do
    ids=$(dc ps -q "$service")
    [[ -n "$ids" && $ids != *$'\n'* ]] || die '服务未完整运行，暂不允许清理。'
    if [[ $service == gateway ]]; then
      [[ $(docker inspect --format '{{.State.Status}}' "$ids") == running ]] || die '网关未运行，暂不允许清理。'
    else
      [[ $(docker inspect --format '{{.State.Status}}/{{.State.Health.Status}}' "$ids") == running/healthy ]] || die '服务尚未健康，暂不允许清理。'
    fi
    case "$service" in api) expected=$(value APP_IMAGE release.env);; gateway) expected=$(value GATEWAY_IMAGE release.env);; *) continue;; esac
    actual=$(docker inspect --format '{{.Config.Image}}' "$ids")
    [[ $actual == "$expected" ]] || die '运行镜像与当前版本不一致，可能升级未完成，暂不允许清理。'
  done
  domain=$(value APP_DOMAIN config/gateway.env)
  curl --fail --silent --show-error --max-time 10 "https://$domain/" -o /dev/null || die 'HTTPS 检查未通过，暂不允许清理。'
}
cleanup_image_used(){
  local ref=$1 image ids id used
  image=$(docker image inspect --format '{{.Id}}' "$ref") || return 0
  ids=$(docker ps -aq) || return 0
  for id in $ids; do
    used=$(docker inspect --format '{{.Image}}' "$id") || return 0
    [[ $used != "$image" ]] || return 0
  done
  return 1
}
# Called only after upgrade, HTTPS verification and maintenance-script replacement
# have completed. This deliberately does not invoke the broader cleanup command.
upgrade_package(){
  local current=$1 package=$2
  if ! (
    # Only the explicit upgrade input, outside the live installation, is disposable.
    [[ $package != "$base" && $package != "$base"/* && $base != "$package"/* && $(basename -- "$package") == "starlit-$current-source" ]] || exit 1
    [[ ! -e "$package/config" && ! -e "$package/data" ]] || exit 1
    cleanup_tree "$package" && cleanup_tree "$base/releases/$current" || exit 1
    diff -qr -- "$package" "$base/releases/$current" >/dev/null || exit 1
    cleanup_ready || exit 1
    rm -rf --one-file-system -- "$package" || exit 1
    echo "已自动删除本次升级解压目录：$package"
  ); then
    echo "升级已完成，但解压目录未通过清理检查或删除未完成，已保留供检查：$package" >&2
  fi
}
upgrade_downloads(){
  local current=$1 archive
  archive="/root/starlit-$current-source.tar.gz"
  if [[ ! -e "$archive" && ! -L "$archive" && ! -e "$archive.sha256" && ! -L "$archive.sha256" ]]; then return 0; fi
  if ! (
    [[ -f "$archive" && ! -L "$archive" && -f "$archive.sha256" && ! -L "$archive.sha256" ]] || exit 1
    [[ $(realpath -e -- "$archive") == "$archive" && $(realpath -e -- "$archive.sha256") == "$archive.sha256" ]] || exit 1
    # The retained release is what future restarts/rebuilds use, not the download.
    cleanup_tree "$base/releases/$current" || exit 1
    hash=$(sha256sum -- "$archive") || exit 1
    hash=${hash%% *}
    [[ $(cat -- "$archive.sha256") == "$hash  $(basename -- "$archive")" ]] || exit 1
    # A same-version archive must also belong to this exact installed bundle.
    tar -xOzf "$archive" "starlit-$current-source/SHA256SUMS" | cmp - "$base/releases/$current/SHA256SUMS" || exit 1
    cleanup_ready || exit 1
    rm -- "$archive" "$archive.sha256" || exit 1
    echo "已自动删除本次上传文件：$archive 和同名 .sha256 文件"
  ); then
    echo '升级已完成，但上传文件未能通过清理检查或删除未完成；请保留剩余文件，网站不受影响。' >&2
  fi
}
cleanup(){
  shift
  local apply=0 downloads=0 package='' archive='' current previous='' folder version name project count=0 ref prefix answer size total=0 hash before
  local -a remove_dirs=() remove_files=() remove_images=()
  local -A keep=() known=() known_images=() fingerprints=()
  for ref in realpath mountpoint diff find du sha256sum; do command -v "$ref" >/dev/null || die "缺少清理所需工具：$ref"; done
  while (( $# )); do
    case "$1" in
      --apply) apply=1; shift;;
      --downloads) downloads=1; shift;;
      --package|--archive)
        [[ $# -ge 2 && $2 == /* && $2 != *$'\n'* ]] || die '请提供完整绝对路径。'
        if [[ $1 == --package ]]; then package=$2; else archive=$2; fi
        shift 2;;
      *) die '未知清理参数，请运行 bash starlit.sh help。';;
    esac
  done
  [[ $(realpath -e -- "$base") == "$base" ]] || die '安装目录包含符号链接，拒绝清理。'
  current=$(value RELEASE_VERSION release.env)
  [[ $current =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-z0-9.]+)?$ ]] || die '当前版本号无效。'
  if (( downloads )); then
    [[ -z "$archive" ]] || die '--downloads 与 --archive 只能选择一种。'
    archive="/root/starlit-$current-source.tar.gz"
    if [[ ! -e "$archive" && ! -L "$archive" && ! -e "$archive.sha256" && ! -L "$archive.sha256" ]]; then
      echo "未找到本次下载文件，跳过：$archive"; archive=''
    fi
  fi
  project=$(value COMPOSE_PROJECT_NAME config/compose.env)
  [[ $project =~ ^starlit_[a-f0-9]{12}$ ]] || die '项目标识无效。'
  cleanup_ready
  keep[$current]=1
  for folder in "$base/backups" "$base/releases"; do
    [[ ! -e "$folder" || ( -d "$folder" && ! -L "$folder" ) ]] || die '备份或版本目录不安全，拒绝清理。'
  done
  # A successful backup is evidence that this installation actually used a version.
  while IFS= read -r name; do
    [[ $name =~ ^[0-9]{8}T[0-9]{6}Z\.[a-zA-Z0-9]+$ ]] || continue
    folder="$base/backups/$name"
    if [[ -e "$folder/INCOMPLETE" || ! -s "$folder/database.dump" ]] || ! cleanup_tree "$folder"; then
      echo "保留未完成、异常或校验不通过的备份：$folder"; continue
    fi
    [[ $(value COMPOSE_PROJECT_NAME "$folder/config/compose.env") == "$project" ]] || { echo "保留其他项目备份：$folder"; continue; }
    version=$(value RELEASE_VERSION "$folder/release.env")
    [[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-z0-9.]+)?$ ]] || continue
    known[$version]=1
    for ref in APP_IMAGE GATEWAY_IMAGE; do
      hash=$(value "$ref" "$folder/release.env")
      for prefix in "starlit-app:$version" "starlit-gateway:$version"; do
        if [[ $hash == "$prefix" || ( $hash == "$prefix-"* && ${hash#"$prefix-"} =~ ^[a-f0-9]{12}$ ) ]]; then known_images[$hash]=$version; fi
      done
    done
    if [[ -z "$previous" && $version != "$current" ]]; then previous=$version; keep[$version]=1; fi
    count=$((count+1))
    if (( count <= 2 )); then keep[$version]=1; echo "保留完整备份：$folder";
    else remove_dirs+=("$folder"); fi
  done < <(if [[ -d "$base/backups" ]]; then find "$base/backups" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort -r; fi)
  # Retained backups may need older images/sources; keep those versions as well.
  while IFS= read -r name; do
    [[ $name =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-z0-9.]+)?$ ]] || continue
    folder="$base/releases/$name"
    [[ -z ${keep[$name]:-} && -n ${known[$name]:-} && -n "$previous" ]] || continue
    if cleanup_tree "$folder" && [[ $(value RELEASE_VERSION "$folder/release.env") == "$name" ]]; then remove_dirs+=("$folder");
    else echo "保留异常版本目录：$folder"; fi
  done < <(if [[ -d "$base/releases" ]]; then find "$base/releases" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort; fi)
  if [[ -n "$package" ]]; then
    [[ $package != "$base" && $package != "$base"/* && $base != "$package"/* && $(basename -- "$package") == "starlit-$current-source" && ! -e "$package/config" && ! -e "$package/data" ]] || die '只接受安装目录之外、本次版本的新解压源码包。'
    cleanup_tree "$package" && cleanup_tree "$base/releases/$current" || die '源码包或内部副本不完整，拒绝删除。'
    diff -qr -- "$package" "$base/releases/$current" >/dev/null || die '外部源码包与当前内部副本不一致，拒绝删除。'
    remove_dirs+=("$package")
  fi
  if [[ -n "$archive" ]]; then
    [[ $archive != "$base"/* && $(basename -- "$archive") == "starlit-$current-source.tar.gz" && -f "$archive" && ! -L "$archive" && $(realpath -e -- "$archive") == "$archive" && -f "$archive.sha256" && ! -L "$archive.sha256" ]] || die '只接受安装目录外、本次版本的压缩包及校验文件。'
    cleanup_archive_source "$current" || die '当前版本源码未通过校验，拒绝清理下载包。'
    hash=$(sha256sum -- "$archive"); hash=${hash%% *}
    [[ $(cat -- "$archive.sha256") == "$hash  $(basename -- "$archive")" ]] || die '压缩包校验不通过，保留文件以便排查。'
    remove_files+=("$archive" "$archive.sha256")
  fi
  for ref in "${!known_images[@]}"; do
    version=${known_images[$ref]}
    [[ -z ${keep[$version]:-} && -n "$previous" ]] || continue
    docker image inspect "$ref" >/dev/null 2>&1 || continue
    if cleanup_image_used "$ref"; then echo "保留被容器引用的镜像：$ref"; else remove_images+=("$ref"); fi
  done
  echo "当前版本：$current；上一版本：${previous:-无法确认，版本副本与镜像均保留}"
  echo '以下是本次清理清单（不会清理运行数据、配置、证书、基础镜像或构建缓存）：'
  for folder in "${remove_dirs[@]}" "${remove_files[@]}"; do
    size=$(du -sk -- "$folder"); size=${size%%$'\t'*}; total=$((total+size))
    echo "文件：$folder（约 $size KiB）"
    if [[ -d "$folder" ]]; then hash=$(sha256sum -- "$folder/SHA256SUMS"); else hash=$(sha256sum -- "$folder"); fi
    fingerprints[$folder]=${hash%% *}
  done
  for ref in "${remove_images[@]}"; do echo "镜像：$ref（共享层回收量以 Docker 执行结果为准）"; done
  echo "文件合计约 $total KiB；镜像空间未计入。"
  (( ${#remove_dirs[@]}+${#remove_files[@]}+${#remove_images[@]} )) || { echo '没有可清理对象。'; return; }
  (( apply )) || { echo '预览完成，未删除。确认网站、签到和抽奖正常后，原命令加 --apply 执行。'; return; }
  read -r -p '确认功能正常并删除上述对象？输入 CLEAN：' answer || die '未确认，未删除。'
  [[ $answer == CLEAN ]] || { echo '已取消，未删除。'; return; }
  [[ $(value RELEASE_VERSION release.env) == "$current" && $(value COMPOSE_PROJECT_NAME config/compose.env) == "$project" ]] || die '安装配置已变化，未开始清理。'
  cleanup_ready
  # Recheck every file before starting deletion, including files changed during confirmation.
  if [[ -n "$archive" ]]; then cleanup_archive_source "$current" || die '当前版本源码已变化，未开始清理。'; fi
  for folder in "${remove_dirs[@]}" "${remove_files[@]}"; do
    [[ ! -L "$folder" && $(realpath -e -- "$folder") == "$folder" ]] || die '路径已变化，未开始清理。'
    if [[ -d "$folder" ]]; then cleanup_tree "$folder" || die '目录内容已变化，未开始清理。'; hash=$(sha256sum -- "$folder/SHA256SUMS");
    else hash=$(sha256sum -- "$folder"); fi
    [[ ${hash%% *} == "${fingerprints[$folder]}" ]] || die '清单对象已变化，未开始清理。'
  done
  for folder in "${remove_dirs[@]}"; do rm -r --one-file-system -- "$folder"; done
  for folder in "${remove_files[@]}"; do rm -- "$folder"; done
  for ref in "${remove_images[@]}"; do
    if cleanup_image_used "$ref"; then echo "跳过已被引用的镜像：$ref";
    else docker image rm "$ref" || echo "镜像未删除，已保留：$ref"; fi
  done
  echo "清理完成。已删除文件清理前占用约 $total KiB；镜像回收结果见上方 Docker 输出。"
}

if [[ $action == restore ]]; then
  [[ $# == 2 ]] || die '请指定备份目录。'
  [[ ! -e config && ! -e data ]] || die '只允许恢复到全新的部署目录，不会覆盖已有配置或数据。'
  saved=$(cd -- "$2" && pwd)
  verify_tree "$saved"
  [[ ! -e "$saved/INCOMPLETE" && -s "$saved/database.dump" && -f "$saved/config/compose.env" ]] || die '备份不完整。'
  project=$(value COMPOSE_PROJECT_NAME "$saved/config/compose.env")
  [[ $project =~ ^starlit_[a-f0-9]{12}$ ]] || die '备份的项目标识无效。'
  [[ -z $(docker ps -aq --filter "label=com.docker.compose.project=$project") ]] || die '本机仍存在原项目容器；请在另一台服务器恢复，避免误用原项目。'
  # Use the backup's exact release; source package must match that release.
  cmp -s release.env "$saved/release.env" || die '请使用与备份相同版本的部署包恢复。'
  images "$base"
  cp -a "$saved/config" ./config
  cp -a "$saved/data" ./data
  cp "$saved/compose.yaml" ./compose.yaml
  directories
  database
  dc exec -T db pg_restore --exit-on-error --no-owner -U starlit -d starlit < "$saved/database.dump"
  migrate
  web
  echo '恢复完成。请另行确认微信授权和图片访问。'
  exit 0
fi
[[ -f config/compose.env ]] || die '请先运行 sudo bash install.sh。'

case "$action" in
  cleanup) cleanup "$@";;
  start)
    directories
    current_images
    database
    migrate
    exists=$(dc run --rm --no-deps -T api node deploy/container/runtime.mjs has-account)
    case "$exists" in no) account init;; yes) ;; *) die '无法确认账号初始化状态。';; esac
    web
    ;;
  stop) dc stop gateway api db;;
  status) dc ps -a;;
  logs) dc logs --tail 100 db api gateway;;
  reset-password) database; account reset-password;;
  backup) backup;;
  upgrade)
    [[ $# == 2 ]] || die '请指定新版本部署包目录。'
    next=$(cd -- "$2" && pwd)
    [[ $next != "$base" && $next != "$base"/* && ! -e "$next/config" && ! -e "$next/data" ]] || die '请使用部署目录之外、新解压且尚未安装的新版本包。'
    verify_tree "$next"
    version=$(value RELEASE_VERSION "$next/release.env")
    [[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-z0-9.]+)?$ ]] || die '新版本号无效。'
    [[ $version != "$(value RELEASE_VERSION release.env)" ]] || die '版本号相同，无需升级。'
    images "$next"
    # Keep the matching image sources for future restarts, even if the operator
    # deletes the downloaded package or prunes Docker's local image cache.
    install -d -m0700 releases
    [[ ! -e "releases/$version" ]] || die '此版本已准备过，请检查上次升级状态；不会覆盖已有版本包。'
    cp -a "$next" "releases/$version"
    backup yes
    # Keep a version-specific backup before applying irreversible DB migrations.
    cp "$next/release.env" ./release.env
    cp "$next/compose.yaml" ./compose.yaml
    echo "升级失败时网站将保持停止，请保留备份：$backup_path"
    migrate
    web
    # Atomic rename keeps the executing shell's original script readable.
    for file in starlit.sh install.sh engine.sh; do
      cp "$next/$file" "./$file.next"
      mv -- "./$file.next" "./$file"
    done
    echo "升级完成，升级前备份：$backup_path"
    upgrade_downloads "$version"
    upgrade_package "$version" "$next"
    ;;
esac
