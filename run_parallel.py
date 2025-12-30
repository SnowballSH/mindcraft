#!/usr/bin/env python3
import argparse
import copy
import json
import os
import signal
import subprocess
import sys
import time


def parse_args():
    parser = argparse.ArgumentParser(
        description="Run multiple node main.js instances with unique VLLM_URL ports."
    )
    parser.add_argument(
        "count",
        type=int,
        help="Number of instances to start."
    )
    parser.add_argument(
        "--base-port",
        type=int,
        default=8000,
        help="Base port for VLLM_URL (default: 8000)."
    )
    parser.add_argument(
        "--port-step",
        type=int,
        default=1,
        help="Port increment per instance (default: 1)."
    )
    parser.add_argument(
        "--host",
        default="0.0.0.0",
        help="Host for VLLM_URL (default: 0.0.0.0)."
    )
    parser.add_argument(
        "--mindserver-base",
        type=int,
        default=8780,
        help="Base port for MINDSERVER_PORT (default: 8780)."
    )
    parser.add_argument(
        "--mindserver-step",
        type=int,
        default=1,
        help="Mindserver port increment per instance (default: 1)."
    )
    parser.add_argument(
        "--profiles",
        nargs="+",
        help="Profile JSON files to clone with unique agent names per instance."
    )
    parser.add_argument(
        "node_args",
        nargs=argparse.REMAINDER,
        help="Extra args passed to node main.js (prefix with --)."
    )
    return parser.parse_args()


def build_vllm_url(host, port):
    return f"http://{host}:{port}/v1"


def normalize_paths(repo_root, paths):
    resolved = []
    for path in paths:
        resolved.append(path if os.path.isabs(path) else os.path.join(repo_root, path))
    return resolved


def load_profiles(profile_paths):
    profiles = []
    for profile_path in profile_paths:
        with open(profile_path, "r", encoding="utf-8") as handle:
            profiles.append((profile_path, json.load(handle)))
    return profiles


def ensure_profile_dir(repo_root):
    profile_dir = os.path.join(repo_root, ".run_parallel_profiles")
    os.makedirs(profile_dir, exist_ok=True)
    return profile_dir


def write_instance_profiles(instance_index, profiles, profile_dir):
    out_paths = []
    for profile_index, (source_path, profile_data) in enumerate(profiles):
        data = copy.deepcopy(profile_data)
        base_name = data.get("name") or os.path.splitext(os.path.basename(source_path))[0]
        data["name"] = f"{base_name}_{instance_index}"
        out_path = os.path.join(profile_dir, f"profile_{instance_index}_{profile_index}.json")
        with open(out_path, "w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=4)
            handle.write("\n")
        out_paths.append(out_path)
    return out_paths


def start_instances(args):
    if args.count < 1:
        raise ValueError("count must be >= 1")

    processes = []
    repo_root = os.path.dirname(os.path.abspath(__file__))
    default_profiles = ["./andy.json"]
    profile_paths = args.profiles or default_profiles
    profile_paths = normalize_paths(repo_root, profile_paths)
    if not all(os.path.exists(path) for path in profile_paths):
        missing = [path for path in profile_paths if not os.path.exists(path)]
        raise FileNotFoundError(f"Profile file(s) not found: {', '.join(missing)}")
    profiles = load_profiles(profile_paths)
    profile_dir = ensure_profile_dir(repo_root)
    for i in range(args.count):
        port = args.base_port + (i * args.port_step)
        mindserver_port = args.mindserver_base + (i * args.mindserver_step)
        env = os.environ.copy()
        vllm_url = build_vllm_url(args.host, port)
        env["VLLM_URL"] = vllm_url
        env["MINDSERVER_PORT"] = str(mindserver_port)
        instance_profiles = write_instance_profiles(i, profiles, profile_dir)
        env["PROFILES"] = json.dumps(instance_profiles)
        cmd = ["node", os.path.join(repo_root, "main.js")] + args.node_args
        proc = subprocess.Popen(cmd, env=env, cwd=repo_root)
        processes.append((proc, vllm_url, mindserver_port))
        print(
            f"[{i}] pid={proc.pid} VLLM_URL={vllm_url} "
            f"MINDSERVER_PORT={mindserver_port} PROFILES={instance_profiles}",
            flush=True
        )
    return processes


def terminate_all(processes, sig=signal.SIGTERM):
    for proc, _, _ in processes:
        if proc.poll() is None:
            try:
                proc.send_signal(sig)
            except Exception:
                pass
    for proc, _, _ in processes:
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


def monitor(processes):
    remaining = list(processes)
    try:
        while remaining:
            for entry in list(remaining):
                proc, vllm_url, mindserver_port = entry
                ret = proc.poll()
                if ret is not None:
                    print(
                        f"pid={proc.pid} exited with {ret} "
                        f"(VLLM_URL={vllm_url} MINDSERVER_PORT={mindserver_port})",
                        flush=True
                    )
                    remaining.remove(entry)
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("Stopping all instances...", flush=True)
        terminate_all(remaining)


def main():
    args = parse_args()
    try:
        processes = start_instances(args)
    except Exception as exc:
        print(f"Failed to start instances: {exc}", file=sys.stderr)
        return 1
    monitor(processes)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
