export function isCrowdfundingPath(path: string) {
  return (
    path === "/" ||
    path === "/kampanye" ||
    path.startsWith("/kampanye/") ||
    path === "/galang-dana" ||
    path === "/kelola-kampanye"
  );
}
