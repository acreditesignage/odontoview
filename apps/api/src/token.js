import crypto from "node:crypto";
export const newToken = () => crypto.randomBytes(32).toString("base64url");
export const hashToken = (value) => crypto.createHash("sha256").update(value).digest("hex");

export async function createAccessToken(prisma, orderId, hours=72) {
  const rawToken=newToken(), expiresAt=new Date(Date.now()+hours*3600000);
  await prisma.patientAccessToken.create({data:{orderId,tokenHash:hashToken(rawToken),expiresAt}});
  return {rawToken,expiresAt};
}
export async function resolveAccessToken(prisma, rawToken) {
  const item=await prisma.patientAccessToken.findUnique({where:{tokenHash:hashToken(rawToken)},include:{order:true}});
  if (!item || item.revokedAt || item.expiresAt<=new Date()) return null;
  await prisma.patientAccessToken.update({where:{id:item.id},data:{lastUsedAt:new Date()}});
  return item;
}
