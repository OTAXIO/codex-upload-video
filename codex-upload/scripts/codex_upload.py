"""Bilibili skill CLI: validate, publish/edit through owned browser, reconcile receipts."""
from __future__ import annotations
import argparse,contextlib,datetime as dt,hashlib,json,os,re,shutil,struct,subprocess,sys,uuid
from pathlib import Path

SKILL=Path(__file__).resolve().parents[1]
CN=dt.timezone(dt.timedelta(hours=8))

class UploadError(Exception):
    def __init__(self,code,message,**details):super().__init__(message);self.code=code;self.details=details

def read(path):return json.loads(Path(path).read_text(encoding='utf-8-sig'))
def write(path,data):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True);tmp=path.with_name(path.name+'.writing')
    tmp.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8');tmp.replace(path)
def now():return dt.datetime.now(CN).isoformat()
def digest(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
    return h.hexdigest()
def implementation_fingerprint():
    files=['scripts/codex_upload.py','scripts/browser.mjs','scripts/forms.mjs']
    return hashlib.sha256(''.join(f+':'+digest(SKILL/f)+'\n' for f in files).encode()).hexdigest()


def problem(code,message,**details):raise UploadError(code,message,**details)

def process_alive(pid):
    if pid<=0:return False
    if os.name=='nt':
        import ctypes
        from ctypes import wintypes
        kernel=ctypes.WinDLL('kernel32',use_last_error=True)
        kernel.OpenProcess.argtypes=[wintypes.DWORD,wintypes.BOOL,wintypes.DWORD];kernel.OpenProcess.restype=wintypes.HANDLE
        kernel.GetExitCodeProcess.argtypes=[wintypes.HANDLE,ctypes.POINTER(wintypes.DWORD)];kernel.CloseHandle.argtypes=[wintypes.HANDLE]
        handle=kernel.OpenProcess(0x1000,False,pid)
        if not handle:
            if ctypes.get_last_error()==87:return False
            raise PermissionError('Cannot inspect process ownership')
        try:
            code=wintypes.DWORD()
            if not kernel.GetExitCodeProcess(handle,ctypes.byref(code)):raise PermissionError('Cannot query process')
            return code.value==259
        finally:kernel.CloseHandle(handle)
    try:os.kill(pid,0);return True
    except ProcessLookupError:return False

def profile(home):
    value=read(SKILL/'assets/default-profile.json')
    local=Path(home)/'user-profile.json'
    if local.exists():value.update(read(local))
    return value

def image_size(path):
    with Path(path).open('rb') as f:
        first=f.read(24)
        if first[:8]==b'\x89PNG\r\n\x1a\n':return struct.unpack('>II',first[16:24])
        if first[:2]!=b'\xff\xd8':problem('INVALID_COVER','Cover must be PNG or JPEG')
        f.seek(2)
        while True:
            byte=f.read(1)
            if not byte:break
            if byte!=b'\xff':continue
            marker=f.read(1)
            while marker==b'\xff':marker=f.read(1)
            if not marker or marker in [b'\xd9',b'\xda']:break
            if marker in [b'\x00',b'\xd8'] or 0xd0<=marker[0]<=0xd7:continue
            raw=f.read(2)
            if len(raw)!=2:break
            length=struct.unpack('>H',raw)[0]
            if marker[0] in {0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf}:
                block=f.read(5);height,width=struct.unpack('>HH',block[1:5]);return width,height
            f.seek(length-2,1)
    problem('INVALID_COVER','Cannot read cover dimensions')

def file_record(path,base):
    path=Path(path)
    if path.is_symlink():problem('UNSAFE_FILE','Symlink assets are not accepted')
    path=path.resolve()
    if not path.is_file():problem('MISSING_FILE','Required local file is missing',path=str(path))
    return dict(path=os.path.relpath(path,base),bytes=path.stat().st_size,sha256=digest(path))

def tags_for(episode,title):
    text=title+' '+json.dumps(episode.get('scenes',[]),ensure_ascii=False)
    tags=['AI']
    for pattern,label in [(r'OpenAI|Open AI','OpenAI'),(r'ChatGPT','ChatGPT'),(r'Codex','Codex'),(r'Claude|Anthropic','Claude'),(r'DeepSeek','DeepSeek'),(r'Qwen|千问','千问'),(r'GLM|Z\.ai|智谱','智谱'),(r'MiniMax','MiniMax')]:
        if re.search(pattern,text,re.I):tags.append(label)
    tags+=['科技资讯']
    if episode.get('footer_tag') in ['早间新闻','午间新闻','晚间新闻','临时新闻']:tags.append(episode['footer_tag'])
    return list(dict.fromkeys(tags))[:10]

def from_release(directory,home,output=None):
    directory=Path(directory).resolve();cfg=profile(home)
    root=cfg.get('release_root') or read(Path(home)/'runtime.local.json').get('release_root')
    if not root or not directory.is_relative_to(Path(root).resolve()):problem('OUTSIDE_RELEASE','Upload source must be under the configured release root')
    release=read(directory/'release.json');pub=read(directory/'publication.json');episode=read(directory/'episode.json')
    if release.get('published') or release.get('state') in {'submitted','reviewing','published'}:problem('ALREADY_PUBLISHED','Do not upload an already submitted/published release')
    if release.get('state')!='ready_for_upload':problem('NOT_READY','Release must have ready_for_upload state')
    name=release.get('video_filename')
    if not name or Path(name).name!=name:problem('INVALID_VIDEO_NAME','Use the named MP4 from release.json')
    video=file_record(directory/name,directory)
    recorded=next((x for x in release.get('archive_files',[]) if x.get('file')==name),None)
    if not recorded or recorded.get('sha256')!=video['sha256']:problem('HASH_MISMATCH','Release MP4 differs from verified export')
    covers={}
    for label,name in [('four_three','cover-4x3.png'),('sixteen_nine','cover-16x9.png')]:
        covers[label]=dict(**file_record(directory/name,directory),width=image_size(directory/name)[0],height=image_size(directory/name)[1])
    tags=pub.get('tags') or tags_for(episode,pub['title']);trimmed=[]
    tags=[tag for tag in tags if tag not in cfg.get('replaced_activity_tags',[])]
    if cfg['activity'].get('strategy')!='none' and len(tags)>9:
        if cfg.get('tag_strategy')=='agent_then_content_rules' and not pub.get('tags_locked'):
            trimmed=tags[9:];tags=tags[:9]
        else:problem('TAG_CAPACITY','Reserve one platform tag for the required activity')
    meta=dict(schema_version=1,operation='upload',release_directory='.',episode_id=episode['id'],alert_id=episode.get('alert_id'),
        reset_event_key=next((s.get('event_key') for s in episode.get('scenes',[]) if s.get('event_key')),None) if episode.get('edition_slot')=='temporary' else None,
        edition_slot=episode.get('edition_slot',release.get('edition_slot')),counts_toward_daily_main_limit=episode.get('counts_toward_daily_main_limit',episode.get('edition_slot')!='temporary'),
        video=video,covers=covers,title=pub['title'],description=pub.get('description',''),tags=tags,tags_reserved_for_activity=trimmed,
        partition=cfg['partition'],collection=cfg['collection'],declarations=cfg['declarations'],activity=cfg['activity'],visibility=cfg['visibility'],captions_burned=True)
    target=Path(output).resolve() if output else directory/'upload.codex.json'
    # Paths in the portable manifest are relative to the manifest, not a machine.
    if target.parent!=directory:
        for record in [meta['video'],*meta['covers'].values()]:record['path']=os.path.relpath(directory/record['path'],target.parent)
        meta['release_directory']=os.path.relpath(directory,target.parent)
    validate_meta(meta,target.parent);write(target,meta)
    return dict(ok=True,manifest=str(target),operation='upload',video_sha256=video['sha256'],submitted=False)

def validate_meta(meta,base):
    required=['title','description','tags','partition','collection','declarations','activity','visibility','captions_burned'] if meta.get('operation','upload')=='upload' else ['target','changes']
    missing=[k for k in required if k not in meta]
    if missing:problem('MISSING_REQUIREMENTS','Supply missing fields together',fields=missing)
    if meta.get('schema_version')!=1:problem('SCHEMA_VERSION','Use manifest schema_version=1')
    operation=meta.get('operation','upload')
    values=meta if operation=='upload' else meta['changes']
    if operation not in {'upload','edit'}:problem('INVALID_OPERATION','Only upload or edit is supported')
    if operation=='edit':
        target=str(meta['target'])
        if not re.fullmatch(r'(?:BV[A-Za-z0-9]{10}|av\d+|\d+)',target):problem('INVALID_TARGET','An explicit BV/av/aid is required for edits')
        if not values or any(k not in {'title','description','tags','covers','partition','collection','declarations','activity','visibility'} for k in values):problem('INVALID_EDIT','Unsupported or empty edit patch')
    if 'title' in values and (not isinstance(values['title'],str) or not 1<=len(values['title'])<=80):problem('INVALID_TITLE','Title must be 1-80 characters')
    if 'description' in values and (not isinstance(values['description'],str) or len(values['description'])>2000):problem('INVALID_DESCRIPTION','Description must be <=2000 characters')
    if 'tags' in values:
        tags=values['tags']
        if not isinstance(tags,list) or not 1<=len(tags)<=10 or any(not isinstance(t,str) or not 1<=len(t)<=20 for t in tags) or len(set(tags))!=len(tags):problem('INVALID_TAGS','Use 1-10 distinct relevant tags, each 1-20 characters')
    if 'declarations' in values and any(not isinstance(values['declarations'].get(k),bool) for k in ['original','ai_generated','no_reprint']):problem('INVALID_DECLARATIONS','Use explicit original/ai_generated/no_reprint booleans')
    if 'visibility' in values and values['visibility'] not in {'public','self'}:problem('INVALID_VISIBILITY','Visibility must be public or self')
    if 'activity' in values and values['activity'].get('strategy') not in {'relevant_popular_free','none','explicit'}:problem('INVALID_ACTIVITY','Unsupported activity strategy')
    if 'covers' in values:
        for label,ratio in [('four_three',4/3),('sixteen_nine',16/9)]:
            record=values['covers'].get(label)
            if not record:problem('MISSING_COVER','Both 4:3 and 16:9 cover records are required')
            p=(Path(base)/record['path']).resolve()
            if not p.is_file() or digest(p)!=record.get('sha256'):problem('HASH_MISMATCH','Cover asset is missing or changed',cover=label)
            w,h=image_size(p)
            if h<1 or abs(w/h-ratio)>.025:problem('WRONG_COVER_RATIO','Cover has the wrong ratio',cover=label)
    if operation=='upload':
        if meta.get('captions_burned') is not True:problem('SUBTITLE_CONTRACT','This default workflow uses burned-in captions')
        record=meta.get('video',{});p=(Path(base)/record.get('path','')).resolve()
        if p.suffix.lower()!='.mp4' or not p.is_file() or digest(p)!=record.get('sha256'):problem('HASH_MISMATCH','MP4 asset is missing or changed')
    return meta

@contextlib.contextmanager
def ownership_lock(home):
    home=Path(home);home.mkdir(parents=True,exist_ok=True);lock=home/'operation.lock'
    if lock.exists():
        try:
            pid=int(lock.read_text());alive=process_alive(pid)
        except (ValueError,PermissionError,OSError):problem('PROFILE_BUSY','Browser operation lock cannot be safely recovered')
        if alive:problem('PROFILE_BUSY','Another upload or login owns this browser')
        lock.unlink()
    with lock.open('x',encoding='utf-8') as f:f.write(str(os.getpid()))
    try:yield
    finally:lock.unlink(missing_ok=True)

def backend(home,mode,meta=None,base=None,progress=None,extra=None):
    home=Path(home).resolve();runtime=read(home/'runtime.local.json');account=read(home/'account.json') if (home/'account.json').exists() else {}
    if not runtime.get('node_executable') or not runtime.get('browser_executable'):problem('RUNTIME_MISSING','Configure Node and Chrome first')
    if mode in {'publish','edit','reconcile'} and not account.get('mid'):problem('ACCOUNT_NOT_PINNED','Run login once to bind the intended account')
    jobs=home/'jobs';jobs.mkdir(parents=True,exist_ok=True);key=uuid.uuid4().hex
    job=dict(mode=mode,runtime=runtime,profile_dir=str(home/'browser-profile'),expected_mid=account.get('mid'),output=str(jobs/(key+'.result.json')),progress=str(progress) if progress else None)
    if extra:job.update({k:v for k,v in extra.items() if k in {'target','attempt_started_at'}})
    if meta:
        job['meta']=json.loads(json.dumps(meta));job['manifest_base']=str(Path(base).resolve())
        for record in ([job['meta']['video']] if mode=='publish' else [])+list((job['meta'] if mode=='publish' else job['meta'].get('changes',{})).get('covers',{}).values()):
            record['path']=str((Path(base)/record['path']).resolve())
    path=jobs/(key+'.job.json');write(path,job)
    with ownership_lock(home):
        process=subprocess.run([runtime['node_executable'],str(SKILL/'scripts/browser.mjs'),str(path)],capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=2400 if mode in {'publish','edit'} else 360)
    # The worker has a filtered JSON contract; never print raw browser stderr.
    try:result=read(job['output'])
    except (OSError,ValueError):problem('BACKEND_CRASH','Browser worker did not produce a valid result; inspect local job status')
    return result

def plan(path,home):
    path=Path(path).resolve();meta=validate_meta(read(path),path.parent)
    return dict(ok=True,operation=meta.get('operation','upload'),episode_id=meta.get('episode_id'),title=meta.get('title'),
                requirements=meta.get('changes',dict(partition=meta.get('partition'),collection=meta.get('collection'),declarations=meta.get('declarations'),activity=meta.get('activity'))),
                tags=meta.get('tags'),submitted=False,network_calls=0)

def execute(path,home,execute=False):
    if not execute:problem('EXECUTION_REQUIRED','Plan is read-only; use --execute for the user-authorized task')
    path=Path(path).resolve();home=Path(home).resolve();meta=validate_meta(read(path),path.parent);cfg=profile(home)
    if not cfg.get('allow_automated_publish'):problem('AUTHORIZATION_REQUIRED','User profile must authorize automated publishing/editing')
    operation=meta.get('operation','upload');key=meta['video']['sha256'] if operation=='upload' else 'edit-'+hashlib.sha256(json.dumps(meta,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
    ledger=home/'state'/(key+'.json');previous=read(ledger) if ledger.exists() else None
    if previous and previous.get('state') in {'submitted','reviewing','published'}:return dict(ok=True,idempotent=True,**previous)
    if previous and previous.get('state') in {'starting','uploading','uploaded','submitting','unknown'}:
        problem('RECONCILE_REQUIRED','A previous attempt may have uploaded/submitted; verify it before another upload',state_file=str(ledger))
    if operation=='upload':
        release=(path.parent/meta.get('release_directory','.')).resolve()
        if not cfg.get('release_root') or not release.is_relative_to(Path(cfg['release_root']).resolve()):problem('OUTSIDE_RELEASE','Publish only under the configured release root')
        current=read(release/'release.json')
        if current.get('published') or current.get('state') in {'submitted','reviewing','published'}:problem('ALREADY_PUBLISHED','Release was already submitted/published')
        if current.get('episode_id')!=meta.get('episode_id'):problem('EDITION_MISMATCH','Manifest does not belong to this release')
        for record in [meta['video'],*meta['covers'].values()]:
            if not (path.parent/record['path']).resolve().is_relative_to(release):problem('OUTSIDE_RELEASE','All upload assets must be inside this release')
        video_name=(path.parent/meta['video']['path']).resolve().name
        actual=next((v for v in current.get('archive_files',[]) if v.get('file')==video_name),{})
        if current.get('video_filename')!=video_name or actual.get('sha256')!=meta['video']['sha256']:problem('HASH_MISMATCH','Manifest video is not the verified release MP4')
        for state in (home/'state').glob('*.json'):
            other=read(state)
            if state!=ledger and other.get('state') not in {'failed','ready'} and any(meta.get(k) and meta.get(k)==other.get(k) for k in ['episode_id','alert_id','reset_event_key']):problem('DUPLICATE_EDITION','This episode/reset event already has an upload attempt')
    progress=home/'state'/(key+'.progress.json');state=dict(key=key,operation=operation,episode_id=meta.get('episode_id'),alert_id=meta.get('alert_id'),reset_event_key=meta.get('reset_event_key'),state='starting',started_at=now(),manifest=str(path))
    write(ledger,state)
    progress.unlink(missing_ok=True)
    try:result=backend(home,'publish' if operation=='upload' else 'edit',meta,path.parent,progress)
    except (UploadError,subprocess.TimeoutExpired,OSError,ValueError) as error:
        observed=read(progress) if progress.exists() else {}
        code=getattr(error,'code','TIMEOUT' if isinstance(error,subprocess.TimeoutExpired) else 'LOCAL_ERROR')
        state.update(state='unknown' if observed.get('video_selected') or observed.get('submit_started') else 'failed',error_code=code,updated_at=now());write(ledger,state)
        return dict(ok=False,**state,error=dict(code=code,message='Upload attempt incomplete; inspect its state before any retry'))
    observed=read(progress) if progress.exists() else {}
    state.update(result=result,updated_at=now())
    if result.get('ok') and (result.get('receipt',{}).get('aid') or result.get('receipt',{}).get('bvid')):
        state.update(state=result.get('state','submitted'),receipt=result['receipt'])
        if operation=='upload':write(path.parent/'upload.receipt.json',state)
    else:state.update(state='unknown' if observed.get('video_selected') or observed.get('submit_started') else 'failed',error_code=result.get('error',{}).get('code','BACKEND_FAILED'))
    write(ledger,state)
    return dict(ok=result.get('ok',False),**state)

def reconcile(key,home):
    if not re.fullmatch(r'(?:edit-)?[a-f0-9]{64}',key):problem('INVALID_KEY','Use a valid ledger key')
    home=Path(home);path=home/'state'/(key+'.json');state=read(path)
    if state.get('state') in {'submitted','reviewing','published'}:return dict(ok=True,**state)
    meta_path=Path(state['manifest']);meta=read(meta_path)
    if state.get('operation')=='edit':
        problem('RECONCILE_REQUIRED','Read the explicit edit target and compare the intended patch; a public title alone cannot verify all edits',target=meta['target'])
    result=backend(home,'reconcile',meta,meta_path.parent,extra=dict(attempt_started_at=state['started_at']))
    if not result.get('ok'):return result
    if result.get('state')=='published' and result.get('receipt',{}).get('aid'):
        state.update(state='published',receipt=result['receipt'],reconciled_at=now());write(path,state);write(meta_path.parent/'upload.receipt.json',state)
    # A returned synchronous field error and our own pre-submit marker prove
    # submitOnce was never entered. Keep an audit record after creator recheck.
    progress=home/'state'/(key+'.progress.json')
    observed=read(progress) if progress.exists() else {}
    field_error=state.get('result',{}).get('error',{}).get('code')
    details=state.get('result',{}).get('error',{}).get('details',{})
    cover_dialog=field_error=='UNKNOWN_DIALOG' and details.get('dialog_text','').startswith('封面制作\n')
    retryable=cover_dialog or field_error in {'SELECTOR_MISSING','AMBIGUOUS_CONTROL','FORM_MISMATCH','COVER_CONTROL_MISSING','COLLECTION_AMBIGUOUS','ACTIVITY_CONTROL_MISSING','COVER_READBACK_FAILED','VISIBILITY_MISSING','READBACK_MISMATCH','PARTITION_MISMATCH','COVER_SAVE_FAILED','COVER_DIALOG_MISSING','COVER_INPUT_MISSING','COVER_NOT_LOADED','COLLECTION_MISMATCH'}
    if result.get('ok') is True and result.get('state')=='unknown' and observed.get('submit_started') is False and retryable:
        state.update(state='failed',reconciled_at=now(),safe_retry_evidence={'creator_recheck':'no confirmed association with a published archive','submit_started':False,'returned_field_error':field_error})
        write(path,state)
    return dict(ok=True,**state)

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--home',default=os.environ.get('CODEX_UPLOAD_HOME',str(Path.home()/'.codex-upload-video')))
    sub=p.add_subparsers(dest='command',required=True)
    for command in ['doctor','login','inspect']:sub.add_parser(command)
    a=sub.add_parser('from-release');a.add_argument('directory');a.add_argument('--output')
    a=sub.add_parser('plan');a.add_argument('manifest')
    for command in ['publish','edit']:
        a=sub.add_parser(command);a.add_argument('manifest');a.add_argument('--execute',action='store_true');a.add_argument('--unattended',action='store_true')
    a=sub.add_parser('status');a.add_argument('key')
    a=sub.add_parser('reconcile');a.add_argument('key')
    a=sub.add_parser('verify');a.add_argument('target')
    args=p.parse_args();home=Path(args.home).resolve()
    try:
        if args.command=='from-release':result=from_release(args.directory,home,args.output)
        elif args.command=='plan':result=plan(args.manifest,home)
        elif args.command in {'publish','edit'}:
            if read(args.manifest).get('operation','upload')!=('upload' if args.command=='publish' else 'edit'):problem('INVALID_OPERATION','Command does not match manifest operation')
            result=execute(args.manifest,home,args.execute)
        elif args.command=='reconcile':result=reconcile(args.key,home)
        elif args.command=='verify':result=backend(home,'verify',extra=dict(target=args.target))
        elif args.command=='status':
            if not re.fullmatch(r'(?:edit-)?[a-f0-9]{64}',args.key):problem('INVALID_KEY','Use an upload SHA-256 or edit key')
            result=read(home/'state'/(args.key+'.json'))
        else:
            result=backend(home,args.command)
            if args.command=='login' and result.get('ok'):write(home/'account.json',dict(mid=result['account']['mid'],verified_at=now()))
        if args.command=='doctor':result['implementation_sha256']=implementation_fingerprint()
        print(json.dumps(result,ensure_ascii=False,indent=2));return 0 if result.get('ok',True) else 2
    except UploadError as error:
        print(json.dumps(dict(ok=False,error=dict(code=error.code,message=str(error),**error.details)),ensure_ascii=False,indent=2));return 2
    except (OSError,ValueError,subprocess.TimeoutExpired):
        print(json.dumps(dict(ok=False,error=dict(code='LOCAL_ERROR',message='Missing/invalid local configuration, file, or expired worker; inspect private diagnostics.'))));return 2

if __name__=='__main__':raise SystemExit(main())
