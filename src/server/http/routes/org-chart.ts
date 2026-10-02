import { readChart, saveChart } from '../../org-chart/policy.js';
import { allowedSpecialists } from '../../../shared/org-chart.js';
import { profiles } from '../../specialists/profiles.js';
import { readBody, sameOrigin, send } from '../util.js';
import { floorParam } from './files.js';
import type { Route } from '../router.js';
export const orgChartRoute: Route = {
  path:'/api/org-chart',auth:'session',
  async handle(ctx,{req,res,url,session}) {
    const floor=floorParam(ctx,url);if(!floor)return send(res,404,{error:'No such floor'});
    const admin=ctx.meOf(session.account?.id).admin;
    const accounts=ctx.accounts.state(new Set()).accounts.map(({id,name,role})=>({id,name,role}));
    try {
      if(req.method==='GET') {
        const chart=readChart(floor.dir);
        chart.assignments=Object.fromEntries(Object.entries(chart.assignments).filter(([id])=>accounts.some(a=>a.id===id)));
        return send(res,200,{chart,accounts,admin,sharedPassword:ctx.accounts.sharedPassword,profiles:profiles(floor.dir).map(({id,name})=>({id,name})),allowed:admin?undefined:allowedSpecialists(chart,session.account?.id??'')});
      }
      if(req.method!=='POST')return send(res,405,{error:'Method not allowed'});
      if(!admin || !sameOrigin(req,ctx.cfg))return send(res,403,{error:'Only an admin can change the org chart'});
      return send(res,200,{chart:saveChart(floor.dir,JSON.parse(await readBody(req,100000)),accounts)});
    }catch(e){return send(res,400,{error:e instanceof Error?e.message:'Could not load the org chart'});}
  },
};
