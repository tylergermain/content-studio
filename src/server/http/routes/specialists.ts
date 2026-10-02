import { profiles, saveProfile } from '../../specialists/profiles.js';
import { readBody, sameOrigin, send } from '../util.js';
import { floorParam } from './files.js';
import type { Route } from '../router.js';
export const specialistRoute: Route = {
  path:'/api/specialists',auth:'session',
  async handle(ctx,{req,res,url,session}) {
    const floor=floorParam(ctx,url);if(!floor) return send(res,404,{error:'No such floor'});
    try {
      if(req.method==='GET') return send(res,200,{profiles:profiles(floor.dir)});
      if(req.method!=='POST') return send(res,405,{error:'Method not allowed'});
      if(!sameOrigin(req,ctx.cfg) || !ctx.meOf(session.account?.id).admin) return send(res,403,{error:'Only an admin can save specialists'});
      const p=saveProfile(floor.dir,JSON.parse(await readBody(req,40000)));
      return send(res,200,{profile:p});
    } catch(e) { return send(res,400,{error:e instanceof Error?e.message:'Could not load specialists'}); }
  },
};
