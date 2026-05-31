export function dot3(a, b){ return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
export function norm3(v){ return Math.hypot(v[0], v[1], v[2]); }
export function normalise3(v){ const n=norm3(v); return n<1e-9?null:v.map(x=>x/n); }

// Gaussian elimination — solves 3×3 system Mv = b, returns v or null
export function gaussElim3(M, b){
  const A = M.map((r,i)=>[...r, b[i]]);
  for (let col=0; col<3; col++){
    let maxR=col;
    for (let r=col+1; r<3; r++) if (Math.abs(A[r][col])>Math.abs(A[maxR][col])) maxR=r;
    [A[col],A[maxR]]=[A[maxR],A[col]];
    if (Math.abs(A[col][col])<1e-10) return null;
    for (let r=col+1; r<3; r++){
      const f=A[r][col]/A[col][col];
      for (let k=col;k<=3;k++) A[r][k]-=f*A[col][k];
    }
  }
  const x=[0,0,0];
  for (let i=2;i>=0;i--){
    x[i]=A[i][3];
    for (let j=i+1;j<3;j++) x[i]-=A[i][j]*x[j];
    x[i]/=A[i][i];
  }
  return x;
}

// Least-squares: finds v such that A*v ≈ b (overconstrained 3-D regression)
export function solveLS3(rows, b){
  const ATA=[[0,0,0],[0,0,0],[0,0,0]], ATb=[0,0,0];
  rows.forEach((r,i)=>{
    for (let j=0;j<3;j++){
      ATb[j]+=r[j]*b[i];
      for (let k=0;k<3;k++) ATA[j][k]+=r[j]*r[k];
    }
  });
  return gaussElim3(ATA, ATb);
}
