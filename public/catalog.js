/* In-page players. A click never changes the main page URL or opens a modal. */
(() => {
 'use strict';
 let activePlayer=null, ytPromise=null, sequence=0;
 const webOrigin=/^https?:$/.test(location.protocol);
 const clean=s=>String(s||'').toLocaleLowerCase().normalize('NFKD').replace(/[\u0300-\u036f\u0591-\u05BD\u05BF-\u05C7]/g,'');
 function loadYouTubeAPI(){
  if(window.YT?.Player)return Promise.resolve(window.YT);
  if(ytPromise)return ytPromise;
  const request=new Promise((resolve,reject)=>{
   const previous=window.onYouTubeIframeAPIReady;
   let settled=false,script=null,owned=false,timer=null;
   function cleanup(){clearTimeout(timer);if(window.onYouTubeIframeAPIReady===ready)window.onYouTubeIframeAPIReady=previous;if(script)script.removeEventListener('error',failed);}
   function failed(){if(settled)return;settled=true;cleanup();if(owned&&script)script.remove();reject(new Error('YouTube player API could not be loaded'));}
   function ready(){if(settled)return;if(!window.YT?.Player){failed();return;}settled=true;cleanup();if(typeof previous==='function'){try{previous();}catch{}}resolve(window.YT);}
   window.onYouTubeIframeAPIReady=ready;
   script=document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
   if(!script){script=document.createElement('script');script.src='https://www.youtube.com/iframe_api';script.async=true;script.dataset.kcYoutubeApi='true';owned=true;}
   script.addEventListener('error',failed,{once:true});timer=setTimeout(failed,12000);if(owned)document.head.append(script);
  });
  ytPromise=request.catch(error=>{ytPromise=null;throw error;});return ytPromise;
 }
 function stopPlayer(focus=false){
  const old=activePlayer;if(!old)return;activePlayer=null;sequence++;clearTimeout(old.timer);
  if(old.api){try{old.api.destroy();}catch{}}
  old.embed.replaceChildren();old.embed.hidden=true;old.poster.hidden=false;old.card.querySelector('[data-kc-stop]').hidden=true;old.card.querySelector('[data-kc-player-status]').hidden=true;old.card.querySelector('[data-kc-player-help]').hidden=true;old.card.classList.remove('kc-playing');
  const label=old.card.querySelector('[data-kc-now]');if(label.dataset.kcDefault)label.textContent=label.dataset.kcDefault;if(focus&&old.trigger.isConnected)old.trigger.focus({preventScroll:true});
 }
 function sourceFor(button){
  const {kcMedia:platform,kcId:id,kcKind:kind}=button.dataset;let url;
  if(platform==='youtube'&&/^[A-Za-z0-9_-]{11}$/.test(id))url=new URL(`https://www.youtube-nocookie.com/embed/${id}`);
  else if(platform==='youtubePlaylist'&&/^[A-Za-z0-9_-]{10,100}$/.test(id)){url=new URL('https://www.youtube-nocookie.com/embed/videoseries');url.searchParams.set('list',id);}
  else if(platform==='spotify'&&/^[A-Za-z0-9]{22}$/.test(id)&&['album','track'].includes(kind))return {url:`https://open.spotify.com/embed/${kind}/${id}`,external:`https://open.spotify.com/${kind}/${id}`,platform};
  else return null;
  url.searchParams.set('autoplay','1');url.searchParams.set('playsinline','1');url.searchParams.set('rel','0');url.searchParams.set('enablejsapi','1');if(webOrigin)url.searchParams.set('origin',location.origin);
  return {url:url.href,external:platform==='youtube'?`https://www.youtube.com/watch?v=${id}`:`https://www.youtube.com/playlist?list=${id}`,platform};
 }
 function showStatus(card,text,error=false){const status=card.querySelector('[data-kc-player-status]');status.textContent=text;status.hidden=false;if(error){const help=card.querySelector('[data-kc-player-help]');help.hidden=false;help.open=true;}}
 function showFailure(session,code){
  if(activePlayer!==session)return;clearTimeout(session.timer);session.failed=true;const oldAPI=session.api;session.api=null;if(oldAPI){try{oldAPI.destroy();}catch{}}session.embed.replaceChildren();session.embed.hidden=true;session.poster.hidden=false;session.card.classList.remove('kc-playing');
  let message='This video cannot be played here. Retry, or choose another player below.';
  if(code===2)message='YouTube rejected the video address. Choose another linked player.';else if(code===5)message='Your browser could not play this video. Retry, or choose another player below.';else if(code===153)message='YouTube could not verify the website origin. Try Spotify or open the video on YouTube.';else if(code===100)message='This video is unavailable or private. Try another linked player.';else if(code===101||code===150)message='The video owner does not allow playback on other websites. Try an alternative player below.';showStatus(session.card,message,true);
 }
 function play(button){
  const source=sourceFor(button),card=button.closest('[data-kc-release]');if(!source||!card)return;stopPlayer();
  const token=++sequence,embed=card.querySelector('[data-kc-embed]'),poster=card.querySelector('[data-kc-poster]');const frame=document.createElement('iframe');frame.id=`kc-inline-player-${token}`;frame.title=button.dataset.kcTitle||'Music player';frame.allow='autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture; web-share';frame.allowFullscreen=true;frame.referrerPolicy='strict-origin-when-cross-origin';frame.className=source.platform==='spotify'?'kc-spotify-frame':'kc-youtube-frame';frame.src=source.url;poster.hidden=true;embed.hidden=false;embed.replaceChildren(frame);card.querySelector('[data-kc-stop]').hidden=false;card.classList.add('kc-playing');
  const label=card.querySelector('[data-kc-now]');if(!label.dataset.kcDefault)label.dataset.kcDefault=label.textContent;label.textContent=frame.title;const help=card.querySelector('[data-kc-player-help]');help.hidden=false;help.open=false;const external=help.querySelector('[data-kc-external]');if(external)external.href=source.external;showStatus(card,source.platform==='spotify'?'Loading Spotify player…':'Loading YouTube player…');
  const session={token,card,embed,poster,frame,trigger:button,api:null,timer:null};activePlayer=session;session.timer=setTimeout(()=>{if(activePlayer===session)showStatus(card,'The player is taking longer than expected. Check your connection or try another player.',true);},18000);
  if(!webOrigin&&source.platform!=='spotify')showStatus(card,'This downloaded preview has no website origin. Playback must be checked on the hosted site.',true);
  if(source.platform==='spotify')frame.addEventListener('load',()=>{if(activePlayer===session){clearTimeout(session.timer);showStatus(card,'Press play in the Spotify player. Playback may require sign-in.');}},{once:true});
  else loadYouTubeAPI().then(YT=>{if(activePlayer!==session||!frame.isConnected)return;session.api=new YT.Player(frame.id,{events:{onReady:()=>{if(activePlayer!==session||session.failed)return;clearTimeout(session.timer);showStatus(card,'Use the controls in the video player.');},onStateChange:e=>{if(activePlayer===session&&!session.failed&&e.data===1){clearTimeout(session.timer);card.querySelector('[data-kc-player-status]').hidden=true;}},onAutoplayBlocked:()=>{if(activePlayer!==session||session.failed)return;clearTimeout(session.timer);showStatus(card,'Your browser paused automatic playback. Press play inside the video.');},onError:e=>showFailure(session,e.data)}});}).catch(()=>{if(activePlayer===session&&webOrigin)showStatus(card,'Player controls could not be checked. Retry or open the recording on its platform.',true);});
  if(button.classList.contains('kc-track-play'))embed.scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
 }
 document.querySelectorAll('[data-kc-root]').forEach(root=>{
  if(root.dataset.kcReady)return;root.dataset.kcReady='true';const form=root.querySelector('[data-kc-controls]'),input=root.querySelector('[data-kc-search-input]'),artist=root.querySelector('[data-kc-artist-select]');const cards=[...root.querySelectorAll('[data-kc-release]')],state={projects:'all',work:'all'};const warning=root.querySelector('[data-kc-file-warning]');if(warning)warning.hidden=webOrigin;
  function update(){const words=clean(input.value.trim()).split(/\s+/).filter(Boolean);cards.forEach(card=>{const chosen=state[card.dataset.kcSection];card.hidden=!((chosen==='all'||card.dataset.kcGroups.split(' ').includes(chosen))&&(!artist.value||artist.value===card.dataset.kcArtist)&&words.every(w=>clean(card.dataset.kcSearch).includes(w)));});if(activePlayer?.card.hidden)stopPlayer();root.querySelectorAll('[data-kc-section-panel]').forEach(panel=>{const n=panel.querySelectorAll('[data-kc-release]:not([hidden])').length;panel.querySelector('[data-kc-section-count]').textContent=`${n} ${n===1?'release':'releases'}`;panel.querySelector('[data-kc-empty]').hidden=n!==0;panel.querySelectorAll('[data-kc-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.kcFilter===state[panel.dataset.kcSectionPanel])));});const n=cards.filter(c=>!c.hidden).length;root.querySelector('[data-kc-status]').textContent=`${n} of ${cards.length} releases`;}
  form.hidden=false;root.querySelectorAll('[data-kc-filters]').forEach(el=>el.hidden=false);form.addEventListener('submit',e=>e.preventDefault());form.addEventListener('reset',e=>{e.preventDefault();state.projects='all';state.work='all';input.value='';artist.value='';update();});input.addEventListener('input',update);artist.addEventListener('change',update);root.querySelectorAll('[data-kc-filter]').forEach(b=>b.addEventListener('click',()=>{state[b.closest('[data-kc-filters]').dataset.kcFilters]=b.dataset.kcFilter;update();}));root.addEventListener('click',e=>{const button=e.target.closest('button[data-kc-play]');if(button&&root.contains(button)){e.preventDefault();play(button);return;}const retry=e.target.closest('[data-kc-retry]');if(retry&&activePlayer?.card===retry.closest('[data-kc-release]')){e.preventDefault();play(activePlayer.trigger);return;}const close=e.target.closest('[data-kc-stop]');if(close)stopPlayer(true);});root.querySelectorAll('.kc-thumb').forEach(img=>{const handle=()=>{if(img.naturalWidth)img.closest('[data-kc-poster]').classList.add('kc-has-image');else img.hidden=true;};img.addEventListener('load',handle);img.addEventListener('error',()=>{img.hidden=true;});if(img.complete)handle();});update();
 });
 window.addEventListener('pagehide',()=>stopPlayer());
})();