window.__reel={
  DUR,
  get time(){return T;},
  rebuild(){build();apply(T);},
  seekTo(t){
    playing=false;ended=false;
    replay.classList.remove('show');
    document.body.classList.remove('hidechrome');
    seek(t);apply(T);
  }
};
