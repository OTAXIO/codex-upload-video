"""Offline release gate: actual isolated Chrome plus Python contract checks.

The receipt is valid only for this exact public skill/test tree. No login,
production media, account profile or live platform submission is used.
"""
from __future__ import annotations
import argparse,datetime as dt,hashlib,json,os,re,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent

def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def public_skill_files(skill):
    return sorted((p.relative_to(skill) for p in Path(skill).rglob('*') if p.is_file() and '__pycache__' not in p.parts and p.suffix in {'.py','.mjs','.md','.json','.yaml','.txt'}),key=lambda p:p.as_posix())

def tree_fingerprint(root=ROOT):
    root=Path(root);paths=[root/'validate.py']
    paths += [root/'codex-upload'/p for p in public_skill_files(root/'codex-upload')]
    paths += [p for p in (root/'tests').rglob('*') if p.is_file() and '__pycache__' not in p.parts]
    return hashlib.sha256(''.join(p.relative_to(root).as_posix()+':'+digest(p)+'\n' for p in sorted(paths)).encode()).hexdigest()

def require_receipt(root=ROOT):
    root=Path(root);file=root/'.validation/latest.json'
    if not file.is_file():raise ValueError('UPLOAD_VALIDATION_REQUIRED: run uploader validate.py with isolated Chrome before deployment')
    receipt=json.loads(file.read_text(encoding='utf-8'))
    checks=receipt.get('checks',{})
    if receipt.get('schema')!=1 or receipt.get('ok') is not True or receipt.get('source_tree_sha256')!=tree_fingerprint(root):
        raise ValueError('UPLOAD_VALIDATION_STALE: uploader code, public assets or regression fixtures changed since validation')
    for name,minimum in [('python',15),('chrome',24)]:
        check=checks.get(name,{})
        if check.get('returncode')!=0 or check.get('tests',0)<minimum or check.get('skipped')!=0:
            raise ValueError('UPLOAD_VALIDATION_FAILED: complete Python and actual Chrome regressions with zero skips are required')
        log=root/'.validation'/check.get('log','missing')
        if not log.is_file() or digest(log)!=check.get('log_sha256'):raise ValueError('UPLOAD_VALIDATION_EVIDENCE_MISSING: validation log is absent or changed')
    return receipt

def validate(node,browser,puppeteer,root=ROOT):
    root=Path(root);out=root/'.validation';out.mkdir(exist_ok=True)
    receipt={'schema':1,'ok':False,'source_tree_sha256':tree_fingerprint(root),'validated_at':dt.datetime.now(dt.timezone.utc).isoformat(),'checks':{}}
    report=out/'latest.json'
    def save():report.write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    save()  # A failed/interrupted run must invalidate the previous green receipt.
    for label,file in [('node',node),('chrome',browser),('puppeteer',puppeteer)]:
        if not Path(file).is_file():raise ValueError('Validation runtime is missing: '+label)
    env=os.environ.copy();env.update(CUP_BROWSER=str(browser),CUP_PUPPETEER_MODULE=str(puppeteer),PYTHONIOENCODING='utf-8',PYTHONDONTWRITEBYTECODE='1')
    commands={'python':[sys.executable,'-B','-m','unittest','discover','-s','tests','-p','test_*.py','-v'],
              'chrome':[str(node),'--test','--test-reporter=tap',*[p.relative_to(root).as_posix() for p in sorted((root/'tests').glob('*.test.mjs'))]]}
    for name,command in commands.items():
        result=subprocess.run(command,cwd=root,env=env,capture_output=True,text=True,encoding='utf-8',timeout=300)
        log=result.stdout+'\n'+result.stderr;(out/(name+'.log')).write_text(log,encoding='utf-8')
        count=re.search(r'Ran (\d+) tests?',log) if name=='python' else re.search(r'^# tests (\d+)$',log,re.M)
        skipped=(int(m.group(1)) if (m:=re.search(r'^# skipped (\d+)$',log,re.M)) else -1) if name=='chrome' else len(re.findall(r'\.\.\. skipped\b',log))
        receipt['checks'][name]={'returncode':result.returncode,'tests':int(count.group(1)) if count else 0,'skipped':skipped,'log':name+'.log','log_sha256':digest(out/(name+'.log'))}
        save()
        if result.returncode or not count or skipped:raise ValueError('Uploader '+name+' validation failed; inspect '+str(out/(name+'.log')))
    if tree_fingerprint(root)!=receipt['source_tree_sha256']:raise ValueError('Source changed while validation was running; validate the complete final tree again')
    receipt['runtime']={label:{'path':str(file),'sha256':digest(file)} for label,file in [('node',node),('chrome',browser),('puppeteer',puppeteer)]}
    receipt['ok']=True;save();require_receipt(root);return receipt

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--node',required=True);parser.add_argument('--browser',required=True);parser.add_argument('--puppeteer',required=True);args=parser.parse_args()
    try:result=validate(args.node,args.browser,args.puppeteer);print(json.dumps(result,ensure_ascii=False,indent=2))
    except (ValueError,subprocess.TimeoutExpired) as error:print(str(error),file=sys.stderr);sys.exit(2)
