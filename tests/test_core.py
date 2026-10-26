import copy,hashlib,importlib.util,json,struct,subprocess,tempfile,unittest,zlib
from pathlib import Path
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('codex_upload',ROOT/'codex-upload/scripts/codex_upload.py')
u=importlib.util.module_from_spec(spec);spec.loader.exec_module(u)

def png(w,h):
    def chunk(name,data):return struct.pack('>I',len(data))+name+data+struct.pack('>I',zlib.crc32(name+data)&0xffffffff)
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,2,0,0,0))+chunk(b'IDAT',zlib.compress((b'\0'+b'\xff\xff\xff'*w)*h))+chunk(b'IEND',b'')

class CoreChecks(unittest.TestCase):
    def setUp(self):
        (ROOT/'.test-tmp').mkdir(exist_ok=True)
        self.tmp=tempfile.TemporaryDirectory(dir=ROOT/'.test-tmp');self.root=Path(self.tmp.name);self.home=self.root/'private'
        u.write(self.home/'user-profile.json',dict(release_root=str(self.root/'release'),allow_automated_publish=True))
    def tearDown(self):self.tmp.cleanup()
    def release(self,name='edition',alert=None):
        directory=self.root/'release'/name;directory.mkdir(parents=True)
        movie=directory/(name+'.mp4');movie.write_bytes(b'offline media fixture '+name.encode())
        (directory/'cover-4x3.png').write_bytes(png(80,60));(directory/'cover-16x9.png').write_bytes(png(80,45))
        u.write(directory/'release.json',dict(state='ready_for_upload',published=False,episode_id=name,video_filename=movie.name,archive_files=[dict(file=movie.name,sha256=u.digest(movie))]))
        u.write(directory/'episode.json',dict(id=name,edition_slot='temporary' if alert else 'night',alert_id=alert,scenes=[dict(company='OpenAI',title='Codex feature')]))
        u.write(directory/'publication.json',dict(title='Source grounded title',description='Original summary',tags=['AI','OpenAI']))
        result=u.from_release(directory,self.home);return directory,Path(result['manifest'])
    def assertCode(self,code,fn):
        with self.assertRaises(u.UploadError) as e:fn()
        self.assertEqual(e.exception.code,code)

    def test_portable_metadata_and_zero_network_plan(self):
        directory,manifest=self.release();meta=u.read(manifest)
        self.assertEqual(meta['covers']['four_three']['path'],'cover-4x3.png')
        self.assertTrue(meta['declarations']['ai_generated']);self.assertTrue(meta['declarations']['original']);self.assertTrue(meta['declarations']['no_reprint'])
        self.assertEqual(u.plan(manifest,self.home)['network_calls'],0)
    def test_published_release_and_corrupt_hash_stop_before_network(self):
        directory,manifest=self.release();receipt=u.read(directory/'release.json');receipt['published']=True;u.write(directory/'release.json',receipt)
        self.assertCode('ALREADY_PUBLISHED',lambda:u.from_release(directory,self.home))
        receipt['published']=False;u.write(directory/'release.json',receipt);(directory/'edition.mp4').write_bytes(b'tampered')
        self.assertCode('HASH_MISMATCH',lambda:u.validate_meta(u.read(manifest),directory))
    def test_cover_ratios_and_missing_requirements_are_real_checks(self):
        directory,manifest=self.release();meta=u.read(manifest)
        meta['covers']['four_three']=meta['covers']['sixteen_nine']
        self.assertCode('WRONG_COVER_RATIO',lambda:u.validate_meta(meta,directory))
        del meta['title'];self.assertCode('MISSING_REQUIREMENTS',lambda:u.validate_meta(meta,directory))
    def test_no_execution_or_default_authorization_means_no_browser(self):
        directory,manifest=self.release()
        with patch.object(u,'backend') as backend:
            self.assertCode('EXECUTION_REQUIRED',lambda:u.execute(manifest,self.home))
            u.write(self.home/'user-profile.json',dict(allow_automated_publish=False))
            self.assertCode('AUTHORIZATION_REQUIRED',lambda:u.execute(manifest,self.home,True));backend.assert_not_called()
    def test_submit_receipt_is_idempotent_and_not_approval(self):
        directory,manifest=self.release()
        with patch.object(u,'backend',return_value=dict(ok=True,state='submitted',receipt=dict(aid=123,bvid='BV1aaaaaaaaa'))) as backend:
            first=u.execute(manifest,self.home,True);second=u.execute(manifest,self.home,True)
            self.assertEqual(first['state'],'submitted');self.assertTrue(second['idempotent']);self.assertEqual(backend.call_count,1)
        self.assertFalse(u.read(directory/'release.json')['published'])
    def test_ambiguous_partial_upload_never_blindly_retries(self):
        directory,manifest=self.release()
        def interrupted(home,mode,meta,base,progress):
            u.write(progress,dict(video_selected=True,submit_started=False));return dict(ok=False,error=dict(code='READBACK_MISMATCH'))
        with patch.object(u,'backend',side_effect=interrupted) as backend:
            self.assertEqual(u.execute(manifest,self.home,True)['state'],'unknown')
            self.assertCode('RECONCILE_REQUIRED',lambda:u.execute(manifest,self.home,True));self.assertEqual(backend.call_count,1)
    def test_reset_event_cannot_be_uploaded_twice_with_new_encoding(self):
        _,first=self.release('edition-a','stable-reset');_,second=self.release('edition-b','stable-reset')
        with patch.object(u,'backend',return_value=dict(ok=True,state='submitted',receipt=dict(aid=123))):u.execute(first,self.home,True)
        self.assertCode('DUPLICATE_EDITION',lambda:u.execute(second,self.home,True))
    def test_paths_cannot_smuggle_assets_outside_release(self):
        directory,manifest=self.release();outside=self.root/'outside.mp4';outside.write_bytes(b'not authorized')
        meta=u.read(manifest);meta['video'].update(path=str(outside),sha256=u.digest(outside));u.write(manifest,meta)
        self.assertCode('OUTSIDE_RELEASE',lambda:u.execute(manifest,self.home,True))
    def test_edit_requires_explicit_target_and_supported_patch(self):
        meta=dict(schema_version=1,operation='edit',target='latest',changes=dict(title='Changed'))
        self.assertCode('INVALID_TARGET',lambda:u.validate_meta(meta,self.root))
        meta['target']='BV1aaaaaaaaa';u.validate_meta(meta,self.root);meta['changes']['delete']=True
        self.assertCode('INVALID_EDIT',lambda:u.validate_meta(meta,self.root))
    def test_worker_stderr_does_not_leak_credentials(self):
        u.write(self.home/'runtime.local.json',dict(node_executable='node',browser_executable='chrome'))
        with patch.object(u.subprocess,'run',return_value=subprocess.CompletedProcess([],1,'','Cookie: private-value')):
            try:u.backend(self.home,'doctor')
            except u.UploadError as error:
                self.assertEqual(error.code,'BACKEND_CRASH');self.assertNotIn('private-value',str(error))

if __name__=='__main__':unittest.main()
