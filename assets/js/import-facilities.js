(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const headers=['source_name','source_record_id','name','category','county_fips','address','city','state','postal_code','phone','email','website','latitude','longitude','source_url','metadata'];
  $('downloadTemplate').addEventListener('click',()=>{
    const blob=new Blob([headers.join(',')+'\n'],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download='healthcare_facilities_template.csv';link.click();URL.revokeObjectURL(url);
  });
  $('importForm').addEventListener('submit',async event=>{
    event.preventDefault();const file=$('facilityFile').files?.[0],token=$('adminToken').value;
    if(!file||!token)return;
    const status=$('uploadResult');status.textContent='Uploading records…';$('submitUpload').disabled=true;
    try{
      const contentType=file.name.toLowerCase().endsWith('.json')?'application/json':'text/csv';
      const response=await fetch('/api/admin/facilities/import',{method:'POST',headers:{'Content-Type':contentType,'Authorization':'Bearer '+token},body:file,cache:'no-store'});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||'Import failed.');
      status.textContent=`Imported or updated ${result.processed} facility records in ${result.batches} batch(es).`;
      $('adminToken').value='';$('facilityFile').value='';
    }catch(e){status.textContent='Upload failed: '+e.message;}
    finally{$('submitUpload').disabled=false;}
  });
})();
