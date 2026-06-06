const SCOPES=['https://www.googleapis.com/auth/spreadsheets','https://www.googleapis.com/auth/drive.file'];
function base64url(buf){return Buffer.from(buf).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
async function getAccessToken(sa){
  const now=Math.floor(Date.now()/1000);
  const header=base64url(JSON.stringify({alg:'RS256',typ:'JWT'}));
  const claim=base64url(JSON.stringify({iss:sa.client_email,scope:SCOPES.join(' '),aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600}));
  const {createSign}=await import('crypto');
  const sign=createSign('RSA-SHA256');
  sign.update(`${header}.${claim}`);
  const sig=base64url(sign.sign(sa.private_key));
  const jwt=`${header}.${claim}.${sig}`;
  const res=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:jwt})});
  const data=await res.json();
  if(!data.access_token)throw new Error('Token error: '+JSON.stringify(data));
  return data.access_token;
}
async function uploadPhoto(token,folderId,filename,mimeType,base64Data){
  const boundary='abby_boundary_xyz';
  const metadata=JSON.stringify({name:filename,parents:[folderId]});
  const body=[`--${boundary}`,'Content-Type: application/json; charset=UTF-8','',metadata,`--${boundary}`,`Content-Type: ${mimeType}`,'Content-Transfer-Encoding: base64','',base64Data,`--${boundary}--`].join('\r\n');
  const res=await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':`multipart/related; boundary=${boundary}`},body});
  const data=await res.json();
  if(!data.id)throw new Error('Drive upload failed: '+JSON.stringify(data));
  await fetch(`https://www.googleapis.com/drive/v3/files/${data.id}/permissions`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({role:'reader',type:'anyone'})});
  return `https://drive.google.com/file/d/${data.id}/view`;
}
async function appendRow(token,sheetId,row){
  const url=`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A:G:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const res=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({values:[row]})});
  const data=await res.json();
  if(data.error)throw new Error('Sheets error: '+JSON.stringify(data.error));
  return data;
}
export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS')return res.status(200).end();
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  try{
    const sa=JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const sheetId=process.env.SHEET_ID;
    const folderId=process.env.DRIVE_FOLDER_ID;
    const{name,relationship,message,photoData,photoMime,photoName}=req.body;
    if(!name||!message)return res.status(400).json({error:'Name and message are required.'});
    const token=await getAccessToken(sa);
    let photoUrl='';
    if(photoData&&photoMime){const fname=photoName||`photo_${Date.now()}.jpg`;photoUrl=await uploadPhoto(token,folderId,fname,photoMime,photoData);}
    const row=[new Date().toISOString(),name,relationship||'',message,photoUrl,'TRUE',''];
    await appendRow(token,sheetId,row);
    return res.status(200).json({ok:true});
  }catch(err){
    console.error('submit error:',err);
    return res.status(500).json({error:err.message});
  }
}
