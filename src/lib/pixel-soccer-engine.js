/* Pixel Soccer server-authoritative engine */
"use strict";

const W=320,H=240,PITCH_T=28,PITCH_B=236,PITCH_L=12,PITCH_R=308;
const GOAL_W=14,GOAL_H=64,GOAL_CY=(PITCH_T+PITCH_B)/2,GOAL_T=GOAL_CY-GOAL_H/2,GOAL_B=GOAL_CY+GOAL_H/2;
const PLAYER_R=10,BALL_R=6,PLAYER_SPD=90,BALL_FRICTION=0.985,KICK_FORCE=180;
const KICK_RANGE=PLAYER_R+BALL_R+8,KICK_COOLDOWN=300,MATCH_TIME=120,GOAL_PAUSE=1500,KICKOFF_PAUSE=800;

function dist(a,b){var dx=a.x-b.x,dy=a.y-b.y;return Math.sqrt(dx*dx+dy*dy);}
function wallBounce(e,r){
  if(e.y-r<PITCH_T){e.y=PITCH_T+r;e.vy=Math.abs(e.vy)*0.6;}
  if(e.y+r>PITCH_B){e.y=PITCH_B-r;e.vy=-Math.abs(e.vy)*0.6;}
  if(e.x-r<PITCH_L){if(e.y+r>GOAL_T&&e.y-r<GOAL_B){}else{e.x=PITCH_L+r;e.vx=Math.abs(e.vx)*0.6;}}
  if(e.x+r>PITCH_R){if(e.y+r>GOAL_T&&e.y-r<GOAL_B){}else{e.x=PITCH_R-r;e.vx=-Math.abs(e.vx)*0.6;}}
}
function playerWalls(p){var r=PLAYER_R;
  if(p.y-r<PITCH_T)p.y=PITCH_T+r;if(p.y+r>PITCH_B)p.y=PITCH_B-r;
  if(p.x-r<PITCH_L)p.x=PITCH_L+r;if(p.x+r>PITCH_R)p.x=PITCH_R-r;}
function checkGoal(b){
  if(b.x+BALL_R<PITCH_L&&b.y>GOAL_T&&b.y<GOAL_B)return 1;
  if(b.x-BALL_R>PITCH_R&&b.y>GOAL_T&&b.y<GOAL_B)return 0;return-1;}
function cpuTick(p,ball,isP1){
  var dx=ball.x-p.x,dy=ball.y-p.y,d=Math.sqrt(dx*dx+dy*dy);
  var behind=isP1?ball.x<p.x+20:ball.x>p.x-20;
  var tx,ty;if(behind||d<40){tx=ball.x;ty=ball.y;}else{tx=ball.x+(isP1?-25:25);ty=ball.y;}
  var ddx=tx-p.x,ddy=ty-p.y,dd=Math.sqrt(ddx*ddx+ddy*ddy);
  if(dd>2){p.vx=(ddx/dd)*PLAYER_SPD;p.vy=(ddy/dd)*PLAYER_SPD;}else{p.vx=0;p.vy=0;}
  return dist(p,ball)<KICK_RANGE&&p.kickCD<=0;}
function doKick(p,kd,ball){
  if(!kd||p.kickCD>0)return;if(dist(p,ball)>KICK_RANGE)return;
  var gx=p.team===0?PITCH_R:PITCH_L,dx=gx-ball.x+(Math.random()-0.5)*30;
  var dy=GOAL_CY-ball.y+(Math.random()-0.5)*30,len=Math.sqrt(dx*dx+dy*dy)||1;
  ball.vx=(dx/len)*KICK_FORCE;ball.vy=(dy/len)*KICK_FORCE;p.kickCD=KICK_COOLDOWN;}

function createRoom(){return{
  state:"playing",
  p1:{x:W/2-50,y:H/2,vx:0,vy:0,team:0,kickCD:0},
  p2:{x:W/2+50,y:H/2,vx:0,vy:0,team:1,kickCD:0},
  ball:{x:W/2,y:H/2,vx:0,vy:0},score:[0,0],timeLeft:MATCH_TIME,
  stateTimer:0,goalScorer:-1,
  input:{p1:{dx:0,dy:0,kick:false},p2:{dx:0,dy:0,kick:false}},
  cpuP1:false,cpuP2:false,_p1Socket:null,_p2Socket:null,_tickInterval:null};}

function resetPositions(r){
  r.p1.x=W/2-50;r.p1.y=H/2;r.p1.vx=0;r.p1.vy=0;r.p1.kickCD=0;
  r.p2.x=W/2+50;r.p2.y=H/2;r.p2.vx=0;r.p2.vy=0;r.p2.kickCD=0;
  r.ball.x=W/2;r.ball.y=H/2;r.ball.vx=0;r.ball.vy=0;}

function tick(r,dt){var ev=[];
  if(r.state==="goal"||r.state==="fulltime"){r.stateTimer-=dt*1000;
    if(r.stateTimer<=0){if(r.state==="goal"){resetPositions(r);r.state="playing";r.stateTimer=KICKOFF_PAUSE;}else{ev.push({type:"fulltime"});}}return ev;}
  if(r.state!=="playing")return ev;
  r.timeLeft-=dt;if(r.timeLeft<=0){r.timeLeft=0;r.state="fulltime";r.stateTimer=500;ev.push({type:"fulltime"});return ev;}
  r.p1.kickCD=Math.max(0,r.p1.kickCD-dt*1000);r.p2.kickCD=Math.max(0,r.p2.kickCD-dt*1000);
  var ak1=false,ak2=false;
  if(r.cpuP1){ak1=cpuTick(r.p1,r.ball,true);}else{var i1=r.input.p1,l1=Math.sqrt(i1.dx*i1.dx+i1.dy*i1.dy)||1;r.p1.vx=(i1.dx/l1)*PLAYER_SPD;r.p1.vy=(i1.dy/l1)*PLAYER_SPD;}
  if(r.cpuP2){ak2=cpuTick(r.p2,r.ball,false);}else{var i2=r.input.p2;if(i2.dx===0&&i2.dy===0){r.p2.vx=0;r.p2.vy=0;}else{var l2=Math.sqrt(i2.dx*i2.dx+i2.dy*i2.dy);r.p2.vx=(i2.dx/l2)*PLAYER_SPD;r.p2.vy=(i2.dy/l2)*PLAYER_SPD;}}
  r.p1.x+=r.p1.vx*dt;r.p1.y+=r.p1.vy*dt;r.p2.x+=r.p2.vx*dt;r.p2.y+=r.p2.vy*dt;
  playerWalls(r.p1);playerWalls(r.p2);
  var pd=dist(r.p1,r.p2),mn=PLAYER_R*2;
  if(pd<mn&&pd>0){var pu=(mn-pd)/2/pd,dx2=r.p1.x-r.p2.x,dy2=r.p1.y-r.p2.y;r.p1.x+=dx2*pu;r.p1.y+=dy2*pu;r.p2.x-=dx2*pu;r.p2.y-=dy2*pu;}
  r.ball.x+=r.ball.vx*dt;r.ball.y+=r.ball.vy*dt;r.ball.vx*=BALL_FRICTION;r.ball.vy*=BALL_FRICTION;
  if(Math.abs(r.ball.vx)<0.3)r.ball.vx=0;if(Math.abs(r.ball.vy)<0.3)r.ball.vy=0;wallBounce(r.ball,BALL_R);
  function pbb(p){var d2=dist(p,r.ball),md=PLAYER_R+BALL_R;
    if(d2<md&&d2>0){var nx=(r.ball.x-p.x)/d2,ny=(r.ball.y-p.y)/d2;
      r.ball.x=p.x+nx*md;r.ball.y=p.y+ny*md;r.ball.vx+=p.vx*0.4;r.ball.vy+=p.vy*0.4;}}
  pbb(r.p1);pbb(r.p2);
  doKick(r.p1,r.cpuP1?ak1:r.input.p1.kick,r.ball);
  doKick(r.p2,r.cpuP2?ak2:r.input.p2.kick,r.ball);
  var g=checkGoal(r.ball);
  if(g>=0){r.score[g]++;r.goalScorer=g;r.state="goal";r.stateTimer=GOAL_PAUSE;ev.push({type:"goal",scorer:g,score:r.score.slice()});}
  return ev;}

function applyInput(r,sid,input){
  if(r._p1Socket===sid){r.input.p1.dx=input.dx||0;r.input.p1.dy=input.dy||0;r.input.p1.kick=!!input.kick;}
  else if(r._p2Socket===sid){r.input.p2.dx=input.dx||0;r.input.p2.dy=input.dy||0;r.input.p2.kick=!!input.kick;}}

function getSnapshot(r){return{
  state:r.state,
  p1:{x:r.p1.x,y:r.p1.y,vx:r.p1.vx,vy:r.p1.vy,kickCD:r.p1.kickCD},
  p2:{x:r.p2.x,y:r.p2.y,vx:r.p2.vx,vy:r.p2.vy,kickCD:r.p2.kickCD},
  ball:{x:r.ball.x,y:r.ball.y,vx:r.ball.vx,vy:r.ball.vy},
  score:r.score,timeLeft:r.timeLeft,goalScorer:r.goalScorer,stateTimer:r.stateTimer};}

module.exports={createRoom,tick,applyInput,getSnapshot,resetPositions,
  W,H,PITCH_T,PITCH_B,PITCH_L,PITCH_R,GOAL_T,GOAL_B,GOAL_CY,GOAL_W,
  PLAYER_R,BALL_R,PLAYER_SPD,BALL_FRICTION,KICK_FORCE,KICK_RANGE,KICK_COOLDOWN,
  MATCH_TIME,GOAL_PAUSE,KICKOFF_PAUSE};
