import json, time, sys, io, tarfile, subprocess, os, shlex
from datetime import datetime
from zoneinfo import ZoneInfo
from daytona import Daytona, CreateSandboxFromSnapshotParams, CreateSandboxFromImageParams, Resources
MEM=int(sys.argv[1]) if len(sys.argv)>1 else 1
ET=ZoneInfo("America/New_York"); now=lambda: datetime.now(ET).isoformat(timespec="seconds")
OUT="/tmp/fm/out"; os.makedirs(OUT, exist_ok=True)
d=Daytona(); meta={"started_et":now()}; t0=time.time()
sb=d.create(CreateSandboxFromImageParams(image="daytonaio/sandbox:0.11.0", resources=Resources(cpu=2, memory=MEM, disk=5), labels={"app":"two-key-fresh-proof"}, ephemeral=True, auto_stop_interval=30), timeout=600)
meta.update({"sandbox_id":sb.id,"snapshot":sb.snapshot,"cpu":sb.cpu,"memory_gib":sb.memory,"disk_gib":sb.disk,"region":sb.target})
print("sandbox", sb.id, sb.snapshot, sb.cpu, sb.memory, sb.disk, flush=True)
x=lambda c,t=900: sb.process.exec("bash -lc "+shlex.quote(c), timeout=t)
try:
    env=x("cat /etc/os-release | head -4; uname -srm; echo node $(node -v); echo npm $(npm -v); echo git $(git --version); nproc; free -m | head -2; df -h / | tail -1")
    open(f"{OUT}/environment.txt","w").write(env.result); print(env.result, flush=True)
    net=x("curl -s -o /dev/null -w 'registry.npmjs.org %{http_code}\\n' --max-time 15 https://registry.npmjs.org/next; curl -s -o /dev/null -w 'github.com %{http_code}\\n' --max-time 15 https://github.com/JoeProAI/two-key", 60)
    meta["network"]=net.result; print(net.result, flush=True)
    online = "registry.npmjs.org 200" in net.result and "github.com 200" in net.result
    meta["install_path"] = "online: git clone from GitHub + npm ci from registry" if online else "offline"
    if not online:
        raise SystemExit("sandbox has no internet for github/npm; stopping (see network)")
    r=x("cd ~ && rm -rf two-key && git clone -q https://github.com/JoeProAI/two-key.git && cd two-key && git log -1 --format='%H %s' && (npm ci --no-audit --no-fund 2>&1 | tail -3) && echo NPM_CI_EXIT=0", 900)
    meta["clone_and_ci"]=r.result; print(r.result, flush=True)
    r=x("cd ~/two-key && npm run proof > /tmp/proof.log 2>&1; echo PROOF_EXIT=$?; tail -1 /tmp/proof.log; npm run evidence > /tmp/evidence.log 2>&1; echo EVIDENCE_EXIT=$?; git status --short | wc -l | xargs echo DIRTY_FILES=", 1500)
    meta["run"]=r.result; print(r.result, flush=True)
    for f in ("proof.log","evidence.log"):
        open(f"{OUT}/{f}","w").write(x(f"cat /tmp/{f}").result)
    open(f"{OUT}/proof-summary.md","w").write(x("cat ~/two-key/artifacts/proof/summary.md").result)
finally:
    meta["elapsed_s"]=round(time.time()-t0); meta["ended_et"]=now()
    d.delete(sb); meta["deleted"]=True
    try:
        d.get(sb.id); meta["get_after_delete"]="still found"
    except Exception as e:
        meta["get_after_delete"]="not found: "+type(e).__name__
    json.dump(meta, open(f"{OUT}/sandbox.json","w"), indent=2); print(json.dumps(meta, indent=1)[:3000])
