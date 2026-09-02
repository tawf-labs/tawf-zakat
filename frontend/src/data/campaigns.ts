export type Campaign = {
  id: number;
  title: string;
  organization: string;
  category: string;
  raised: number;
  goal: number;
  donors: number;
  daysLeft: number;
  image: string;
};

export const campaigns: Campaign[] = [
  {
    id: 1,
    title: "Emergency Relief for Earthquake Victims in Cianjur",
    organization: "Baznas Indonesia",
    category: "Emergency",
    raised: 125000,
    goal: 150000,
    donors: 2500,
    daysLeft: 12,
    image: "/community-receiving-food-aid-with-dignity.jpg",
  },
  {
    id: 2,
    title: "Build a Clean Water Well for Remote Village",
    organization: "Human Initiative",
    category: "Waqf",
    raised: 8500,
    goal: 12000,
    donors: 170,
    daysLeft: 45,
    image: "/child-with-meal-support.jpg",
  },
  {
    id: 3,
    title: "Scholarship Fund for 100 Orphan Students",
    organization: "Rumah Zakat",
    category: "Zakat",
    raised: 45000,
    goal: 50000,
    donors: 900,
    daysLeft: 5,
    image: "/happy-family-receiving-aid.jpg",
  },
];

export const formatCurrency = (amount: number) => {
  return `${amount.toLocaleString("id-ID", { maximumFractionDigits: 0 })} IDRX`;
};
