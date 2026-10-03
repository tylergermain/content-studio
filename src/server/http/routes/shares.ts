import { tildify } from '../../paths.js';
import { addShare, removeShare, shareGuard } from '../../worker-chat/shares.js';
import { readBody, sameOrigin, send } from '../util.js';
import { floorParam } from './files.js';
import type { Route } from '../router.js';

/**
 * Sharing a folder outside the floor with it, so the files its workers link there open in the
 * office (see worker-chat/shares.ts), and stopping. Only an admin, and only from the office's page.
 */
export const sharesRoute: Route = {
  path:['/api/shares','/api/shares/remove'],auth:'session',
  async handle(ctx,{req,res,url,path:p,session}) {
    const floor=floorParam(ctx,url);if(!floor)return send(res,404,{error:'No such floor'});
    if(req.method!=='POST')return send(res,405,{error:'Method not allowed'});
    if(!sameOrigin(req,ctx.cfg) || !ctx.meOf(session.account?.id).admin)return send(res,403,{error:'Only an admin can share folders with the floor'});
    let body;try{body=JSON.parse(await readBody(req,8192));}catch{return send(res,400,{error:'Invalid request'});}
    if(p==='/api/shares/remove') {
      if(typeof body?.id!=='string' || !removeShare(floor.dir,body.id))return send(res,404,{error:'That folder is not shared with this floor'});
      return send(res,200,{ok:true});
    }
    const share=addShare(floor.dir,typeof body?.dir==='string'?body.dir:'',session.account?.id ?? 'shared',shareGuard(ctx));
    if('error' in share)return send(res,400,{error:share.error});
    return send(res,200,{share:{id:share.id,label:tildify(share.dir)}});
  },
};
