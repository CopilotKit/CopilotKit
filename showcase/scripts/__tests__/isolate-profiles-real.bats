#!/usr/bin/env bats
# Exercise the same profiled services and named volume as a direct showcase test.
setup() {
  command -v docker >/dev/null && docker info >/dev/null 2>&1 || skip "Docker required"
  export XDG_STATE_HOME="$BATS_TEST_TMPDIR/state"
  source "$BATS_TEST_DIRNAME/../cli/_common.sh"
  SHOWCASE_ROOT="$BATS_TEST_TMPDIR/fixture"
  mkdir -p "$SHOWCASE_ROOT/shared"
  PORTS_FILE="$SHOWCASE_ROOT/shared/local-ports.json"
  echo '{}' > "$PORTS_FILE"
  COMPOSE_FILE="$SHOWCASE_ROOT/docker-compose.local.yml"
  fixture_file="$COMPOSE_FILE"
  project="showcase-isotest-profiles-$$-$RANDOM"
  project_filter="label=com.docker.compose.project=$project"
  cat > "$fixture_file" <<'YAML'
services:
  infra:
    image: alpine:3.20
    command: ["sleep", "infinity"]
    profiles: [infra]
    volumes: [data:/data]
  target:
    image: alpine:3.20
    command: ["true"]
    profiles: [target]
volumes:
  data:
YAML
  docker image inspect alpine:3.20 >/dev/null 2>&1 || docker pull alpine:3.20 >/dev/null || skip "Fixture image unavailable"
}

teardown() {
  if [ -n "${project:-}" ] && [ -f "${fixture_file:-}" ]; then
    docker compose -f "$fixture_file" -p "$project" --profile '*' down --remove-orphans --volumes
  fi
}

start_profiled_services() {
  docker compose -f "$COMPOSE_FILE" -p "$project" --profile '*' up -d --wait infra
  docker compose -f "$COMPOSE_FILE" -p "$project" up --exit-code-from target target
  run docker ps -aq --filter "$project_filter"
  [ "$status" -eq 0 ]
  [ "${#lines[@]}" -eq 2 ]
}

assert_project_empty() {
  run docker ps -aq --filter "$project_filter"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  run docker network ls -q --filter "$project_filter"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  run docker volume ls -q --filter "$project_filter"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "isolated teardown removes running and stopped services from all profiles" {
  apply_isolation "$project"
  start_profiled_services
  local run_dir="$ISOLATE_TMPDIR" slot_dir="$ISOLATE_SLOT_DIR/$ISOLATE_SLOT"
  restore_isolation
  assert_project_empty
  [ ! -d "$run_dir" ]
  [ ! -d "$slot_dir" ]
}

@test "reusing an isolated project removes leftovers from inactive profiles" {
  start_profiled_services
  apply_isolation "$project"
  assert_project_empty
  restore_isolation
}
