import { skillLibraryFloor } from '../../../shared/skill-library.js';
import { listSkills, readSkill, saveSkill } from '../../skill-library/library.js';
import { readBody, sameOrigin, send } from '../util.js';
import { floorParam } from './files.js';
import type { Route } from '../router.js';
export const skillLibraryRoute: Route = {
 path:'/api/skill-library',auth:'session',
 async handle(ctx,{req,res,url,session}) {
  const floor=floorParam(ctx,url);if(!floor||!skillLibraryFloor(floor.id))return send(res,404,{error:'This floor does not have a skill library'});
  const admin=ctx.meOf(session.account?.id).admin;
  try {
   const id=url.searchParams.get('skill');
   if(req.method==='GET')return send(res,200,id?readSkill(floor.dir,id,url.searchParams.get('version')||undefined):{skills:listSkills(floor.dir),admin});
   if(req.method!=='POST')return send(res,405,{error:'Method not allowed'});
   if(!admin||!sameOrigin(req,ctx.cfg))return send(res,403,{error:'Only admins can save skill versions'});
   const b=JSON.parse(await readBody(req,1100000));
   return send(res,200,saveSkill(floor.dir,b.id,b.text,b.expected,b.message,b.restore));
  }catch(e){return send(res,400,{error:e instanceof Error?e.message:'Could not load the skill library'});}
 }
};
