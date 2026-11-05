export const CAREERS = ['IMT','IIS','IIT'] as const;
export type Career = typeof CAREERS[number];
export const ACTIVITIES = {pingpong:'Ping pong',futbolito:'Futbolito',videojuegos:'Videojuegos',mesa:'Juegos de mesa'};
export type Activity = keyof typeof ACTIVITIES;
export const NAMES: Record<Career,string> = {IMT:'Ingeniería Mecatrónica',IIS:'Ingeniería Industrial y de Sistemas',IIT:'Ingeniería en Tecnologías de Información'};
export const COLORS: Record<Career,string> = {IMT:'#FF7417',IIS:'#1677FF',IIT:'#A923F5'};
export type Profile = {id:string;name:string;role:'admin'|'judge';enabled:boolean;activities:Activity[]};
export type Team = {id:string;name:string;career:Career;members:string[];activities:Activity[];active:boolean;points:number;createdAt?:unknown};
export type ScoreEvent = {id:string;teamId:string;teamName:string;career:Career;activity:Activity;points:number;judgeId:string;judgeName:string;kind:'score'|'adjustment'|'reversal';reason:string;reverses?:string;createdAt?:{seconds:number}};
export type State = {status:'not_started'|'running'|'paused'|'finished';totals:Record<Career,number>;byActivity:Record<Activity,Record<Career,number>>;recent:{id:string;career:Career;activity:Activity;points:number}[];presets:number[];customPoints:boolean;animations:boolean;rotation:boolean;rotationSeconds:number;reveal:boolean;sharedWinners:boolean;tieWinner:Career|'';revision:number};
export const ZERO = ():Record<Career,number> => ({IMT:0,IIS:0,IIT:0});
export const INITIAL:State = {status:'not_started',totals:ZERO(),byActivity:Object.fromEntries(Object.keys(ACTIVITIES).map(a=>[a,ZERO()])) as State['byActivity'],recent:[],presets:[5,10,20,50],customPoints:false,animations:true,rotation:false,rotationSeconds:20,reveal:false,sharedWinners:false,tieWinner:'',revision:0};
export const STATUS = {not_started:'NO INICIADO',running:'EN CURSO',paused:'PAUSADA',finished:'FINALIZADA'};
export function ranking(totals:Record<Career,number>) {return [...CAREERS].sort((a,b)=>totals[b]-totals[a]);}
export function winners(state:State):Career[] { const order=ranking(state.totals); const tied=order.filter(c=>state.totals[c]===state.totals[order[0]]); return tied.length>1 && state.tieWinner && tied.includes(state.tieWinner) ? [state.tieWinner] : tied; }
