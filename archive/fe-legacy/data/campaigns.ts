export type Campaign = {
  id: number;
  title: string;
  organizationName: string;
  category: string;
  raised: number;
  goal: number;
  donors: number;
  daysLeft: number;
  image: string;
  location?: string;
  // NEW: Storytelling fields
  familiesHelped?: number;
  endDate?: number;
  isVerified?: boolean;
  // URL slug for clean campaign URLs
  slug: string;
};

// Beneficiary story interface
export interface Beneficiary {
  name: string;
  age: number;
  photo: string;
  story: string;
  location: string;
  received: string[];
  impactDate: string;
}

// Organizer message interface
export interface OrganizerMessage {
  name: string;
  role: string;
  photo: string;
  message: string;
  verified: boolean;
}

// Impact metrics interface
export interface ImpactMetrics {
  familiesHelped: number;
  peopleReached: number;
  mealsProvided: number;
  childrenSupported: number;
}

// Impact calculator item
export interface ImpactCalculator {
  amount: number;
  impact: string;
  icon: string;
}

// Journey timeline item
export interface JourneyItem {
  date: string;
  title: string;
  description: string;
  status: 'completed' | 'current' | 'upcoming';
}

// Urgency info
export interface UrgencyInfo {
  type: 'families-waiting' | 'deadline' | 'limited-spots';
  message: string;
  count?: number;
}

export const campaigns: Campaign[] = [
  {
    id: 1,
    title: "Emergency Relief for Earthquake Victims in Cianjur",
    organizationName: "Baznas Indonesia",
    category: "Emergency",
    raised: 125000,
    goal: 150000,
    donors: 2500,
    daysLeft: 12,
    image: "https://www.ypp.co.id/site/uploads/slides/6391630281061-header-cianjur-2.jpeg",
    location: "Indonesia",
    familiesHelped: 237,
    isVerified: true,
    slug: "cianjur"
  },
  {
    id: 2,
    title: "Build a Clean Water Well for Remote Village",
    organizationName: "Human Initiative",
    category: "Waqf",
    raised: 8500,
    goal: 12000,
    donors: 170,
    daysLeft: 45,
    image: "https://waterwellsforafrica.org/wp-content/uploads/2023/11/home-helping-kids-02-1200x800-1-768x512.jpg",
    location: "Global",
    familiesHelped: 45,
    isVerified: true,
    slug: "water-well"
  },
  {
    id: 3,
    title: "Scholarship Fund for 100 Orphan Students",
    organizationName: "Rumah Zakat",
    category: "Zakat",
    raised: 45000,
    goal: 50000,
    donors: 900,
    daysLeft: 5,
    image: "https://orphanlifefoundation.org/wp-content/uploads/2021/07/Children-smiling.png",
    location: "Indonesia",
    familiesHelped: 87,
    isVerified: true,
    slug: "orphans"
  },
  {
    id: 4,
    title: "Food Packages for Families in Need",
    organizationName: "Dompet Dhuafa",
    category: "Sadaqah",
    raised: 12000,
    goal: 25000,
    donors: 240,
    daysLeft: 20,
    image: "https://www.globalgiving.org/pfil/50448/pict_large.jpg",
    location: "Indonesia",
    familiesHelped: 120,
    isVerified: true,
    slug: "food-packages"
  },
  {
    id: 5,
    title: "Medical Aid for Remote Communities",
    organizationName: "Lazismu",
    category: "Zakat",
    raised: 35000,
    goal: 60000,
    donors: 700,
    daysLeft: 18,
    image: "https://iwifoundation.org/wp-content/uploads/2019/07/Reaching-Rural-Communities.png",
    location: "Indonesia",
    familiesHelped: 56,
    isVerified: true,
    slug: "medical-aid"
  },
  {
    id: 6,
    title: "Mosque Renovation Project",
    organizationName: "BWI",
    category: "Waqf",
    raised: 80000,
    goal: 100000,
    donors: 1600,
    daysLeft: 60,
    image: "https://ychef.files.bbci.co.uk/1280x720/p08ytl9r.jpg",
    location: "Global",
    familiesHelped: 200,
    isVerified: true,
    slug: "mosque"
  }
];

// Detailed storytelling data for campaign details page
export const campaignStoryData: Record<number, {
  beneficiaries: Beneficiary[];
  organizerMessage: OrganizerMessage;
  impactMetrics: ImpactMetrics;
  impactCalculator: ImpactCalculator[];
  journey: JourneyItem[];
  urgency: UrgencyInfo;
}> = {
  1: {
    beneficiaries: [
      {
        name: "Siti",
        age: 45,
        photo: "https://images.unsplash.com/photo-1582213782179-e0d53f98f2ca?w=400&h=400&fit=crop&crop=face",
        story: "The earthquake destroyed our home. With this help, we rebuilt and can finally sleep safely at night. My children can finally go to school with full bellies.",
        location: "Cianjur, West Java",
        received: ["Food package", "Temporary shelter", "School supplies"],
        impactDate: "Dec 28, 2024"
      },
      {
        name: "Ahmad",
        age: 52,
        photo: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=400&fit=crop&crop=face",
        story: "I lost my small shop in the earthquake. This support helped me restart my business and support my family again.",
        location: "Cianjur, West Java",
        received: ["Business capital", "Food supplies"],
        impactDate: "Jan 5, 2025"
      },
      {
        name: "Rina",
        age: 38,
        photo: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=400&h=400&fit=crop&crop=face",
        story: "When the earthquake hit, we lost everything. The temporary shelter and food packages saved us during the hardest days.",
        location: "Cianjur, West Java",
        received: ["Temporary shelter", "Medical kit", "Food package"],
        impactDate: "Dec 20, 2024"
      }
    ],
    organizerMessage: {
      name: "Ahmad Rahman",
      role: "Field Director",
      photo: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400&h=400&fit=crop&crop=face",
      message: "I've visited Cianjur 3 times since the earthquake. The resilience of these families inspires me every day. Your support goes directly to those who need it most - transparently, on-chain. Every donation makes a real difference in rebuilding lives.",
      verified: true
    },
    impactMetrics: {
      familiesHelped: 237,
      peopleReached: 1185,
      mealsProvided: 4750,
      childrenSupported: 412
    },
    impactCalculator: [
      { amount: 10000, impact: "1 meal for a family", icon: "Meal" },
      { amount: 50000, impact: "5 meals for families", icon: "Meal" },
      { amount: 100000, impact: "Food package for 1 week", icon: "Box" },
      { amount: 250000, impact: "Shelter materials", icon: "Home" },
      { amount: 500000, impact: "Complete family support", icon: "Family" }
    ],
    journey: [
      {
        date: "Dec 15, 2024",
        title: "Campaign Launched",
        description: "Campaign started with 0 families helped. Beginning fundraising efforts.",
        status: "completed"
      },
      {
        date: "Dec 28, 2024",
        title: "First Distribution",
        description: "First distribution - 50 families received food packages and emergency supplies.",
        status: "completed"
      },
      {
        date: "Jan 10, 2025",
        title: "Shelter Program",
        description: "150 families received temporary shelter materials. Construction began on community center.",
        status: "completed"
      },
      {
        date: "Jan 15, 2025",
        title: "Current Progress",
        description: "237 families helped, distributing weekly food packages. Medical support ongoing.",
        status: "current"
      },
      {
        date: "Feb 2025",
        title: "Next Milestone",
        description: "Target: 300 families with permanent housing support and livelihood training.",
        status: "upcoming"
      }
    ],
    urgency: {
      type: "families-waiting",
      message: "12 families waiting for food this week",
      count: 12
    }
  },
  2: {
    beneficiaries: [
      {
        name: "Fatima",
        age: 34,
        photo: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400&h=400&fit=crop&crop=face",
        story: "Before the well, we walked 3 hours daily for water. Now our children can attend school instead of carrying water.",
        location: "Remote Village, East Nusa Tenggara",
        received: ["Clean water access", "Water storage tank"],
        impactDate: "Nov 15, 2024"
      }
    ],
    organizerMessage: {
      name: "Dr. Sarah Wijaya",
      role: "Project Coordinator",
      photo: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&h=400&fit=crop&crop=face",
      message: "Clean water is a basic right that many communities still lack. This project brings sustainable water solutions to remote areas. Every contribution directly funds well construction and water purification systems.",
      verified: true
    },
    impactMetrics: {
      familiesHelped: 45,
      peopleReached: 225,
      mealsProvided: 0,
      childrenSupported: 120
    },
    impactCalculator: [
      { amount: 10000, impact: "Water for 1 family", icon: "Drop" },
      { amount: 50000, impact: "5 families get water", icon: "Drop" },
      { amount: 100000, impact: "Water storage tank", icon: "Tank" },
      { amount: 250000, impact: "Well construction", icon: "Build" },
      { amount: 500000, impact: "Complete water system", icon: "Tap" }
    ],
    journey: [
      {
        date: "Oct 1, 2024",
        title: "Project Launched",
        description: "Site survey completed and community needs assessment done.",
        status: "completed"
      },
      {
        date: "Nov 15, 2024",
        title: "First Well Completed",
        description: "First well dug and operational. 45 families now have clean water access.",
        status: "current"
      },
      {
        date: "Jan 2025",
        title: "Expansion Phase",
        description: "Plan to construct 3 additional wells in neighboring villages.",
        status: "upcoming"
      }
    ],
    urgency: {
      type: "families-waiting",
      message: "200+ families still without clean water",
      count: 200
    }
  },
  3: {
    beneficiaries: [
      {
        name: "Yusuf",
        age: 14,
        photo: "https://images.unsplash.com/photo-1503454537195-1dcabb73ffb9?w=400&h=400&fit=crop&crop=face",
        story: "This scholarship means everything to me. I can continue my education and dream of becoming a teacher.",
        location: "Jakarta, Indonesia",
        received: ["School tuition", "Books", "Uniform"],
        impactDate: "Jan 1, 2025"
      }
    ],
    organizerMessage: {
      name: "Hj. Mariam Suharto",
      role: "Education Program Director",
      photo: "https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?w=400&h=400&fit=crop&crop=face",
      message: "Education is the key to breaking the cycle of poverty. These scholarships ensure orphan students can stay in school and build a brighter future. Your support changes lives forever.",
      verified: true
    },
    impactMetrics: {
      familiesHelped: 87,
      peopleReached: 87,
      mealsProvided: 0,
      childrenSupported: 87
    },
    impactCalculator: [
      { amount: 10000, impact: "Books for 1 student", icon: "Book" },
      { amount: 50000, impact: "1 month tuition", icon: "Grad" },
      { amount: 100000, impact: "Full semester support", icon: "Read" },
      { amount: 250000, impact: "1 year scholarship", icon: "Grad" },
      { amount: 500000, impact: "Complete education support", icon: "School" }
    ],
    journey: [
      {
        date: "Aug 1, 2024",
        title: "Scholarship Program Launch",
        description: "100 orphan students identified for scholarship program.",
        status: "completed"
      },
      {
        date: "Jan 1, 2025",
        title: "New Semester Support",
        description: "87 students receiving full scholarship support for current semester.",
        status: "current"
      },
      {
        date: "Jun 2025",
        title: "Graduation Ceremony",
        description: "First cohort of scholarship recipients will graduate.",
        status: "upcoming"
      }
    ],
    urgency: {
      type: "deadline",
      message: "5 days left to donate for this semester",
      count: 5
    }
  },
  4: {
    beneficiaries: [
      {
        name: "Aisha",
        age: 42,
        photo: "https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=400&h=400&fit=crop&crop=face",
        story: "With three children and no income, the food packages are a lifeline. We can eat properly again.",
        location: "Surabaya, East Java",
        received: ["Monthly food package"],
        impactDate: "Dec 1, 2024"
      }
    ],
    organizerMessage: {
      name: "Budi Santoso",
      role: "Community Outreach Lead",
      photo: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&h=400&fit=crop&crop=face",
      message: "Food insecurity affects millions. Our monthly food packages ensure vulnerable families have nutritious meals. Every donation directly translates to meals on tables.",
      verified: true
    },
    impactMetrics: {
      familiesHelped: 120,
      peopleReached: 600,
      mealsProvided: 3600,
      childrenSupported: 280
    },
    impactCalculator: [
      { amount: 10000, impact: "1 family food package", icon: "Box" },
      { amount: 50000, impact: "5 families fed", icon: "👨‍👩‍👧" },
      { amount: 100000, impact: "10 families - 1 month", icon: "Dish" },
      { amount: 250000, impact: "25 families supported", icon: "Love" },
      { amount: 500000, impact: "50 families - 2 months", icon: "Hand" }
    ],
    journey: [
      {
        date: "Sep 1, 2024",
        title: "Food Program Started",
        description: "Monthly food distribution program launched for needy families.",
        status: "completed"
      },
      {
        date: "Jan 15, 2025",
        title: "Current Distribution",
        description: "120 families receiving monthly food packages regularly.",
        status: "current"
      },
      {
        date: "Mar 2025",
        title: "Program Expansion",
        description: "Plan to expand to 200 families with additional nutritional support.",
        status: "upcoming"
      }
    ],
    urgency: {
      type: "families-waiting",
      message: "80 families on waiting list",
      count: 80
    }
  },
  5: {
    beneficiaries: [
      {
        name: "Pak Mahmud",
        age: 58,
        photo: "https://images.unsplash.com/photo-1566492031773-4f4e44671857?w=400&h=400&fit=crop&crop=face",
        story: "The medical team came to our village. They treated my diabetes and gave me free medicine. I feel much better now.",
        location: "Papua, Indonesia",
        received: ["Medical treatment", "Free medication", "Health checkup"],
        impactDate: "Dec 10, 2024"
      }
    ],
    organizerMessage: {
      name: "Dr. Linda Kusuma",
      role: "Medical Director",
      photo: "https://images.unsplash.com/photo-1559839734-2b71ea197ec2?w=400&h=400&fit=crop&crop=face",
      message: "Remote communities often lack basic healthcare access. Our mobile medical teams bring essential services to those who need them most. Your donation saves lives.",
      verified: true
    },
    impactMetrics: {
      familiesHelped: 56,
      peopleReached: 280,
      mealsProvided: 0,
      childrenSupported: 95
    },
    impactCalculator: [
      { amount: 10000, impact: "1 medical checkup", icon: "Care" },
      { amount: 50000, impact: "5 patients treated", icon: "Pill" },
      { amount: 100000, impact: "Medical camp for village", icon: "Scope" },
      { amount: 250000, impact: "Mobile clinic day", icon: "Van" },
      { amount: 500000, impact: "Complete health mission", icon: "Med" }
    ],
    journey: [
      {
        date: "Nov 1, 2024",
        title: "Medical Mission Launch",
        description: "First mobile medical team deployed to Papua region.",
        status: "completed"
      },
      {
        date: "Jan 5, 2025",
        title: "Ongoing Care",
        description: "56 families receiving regular medical care and treatments.",
        status: "current"
      },
      {
        date: "Apr 2025",
        title: "New Mission",
        description: "Next medical mission to Kalimantan region planned.",
        status: "upcoming"
      }
    ],
    urgency: {
      type: "families-waiting",
      message: "Patients waiting for treatment",
      count: 45
    }
  },
  6: {
    beneficiaries: [
      {
        name: "Haji Ibrahim",
        age: 65,
        photo: "https://images.unsplash.com/photo-1566753323558-f4e0952af115?w=400&h=400&fit=crop&crop=face",
        story: "Our mosque was crumbling. Now it's being renovated and our community can pray comfortably again.",
        location: "Padang, West Sumatra",
        received: ["Mosque renovation"],
        impactDate: "Dec 5, 2024"
      }
    ],
    organizerMessage: {
      name: "Ustaz H. Abdullah",
      role: "Waqf Project Manager",
      photo: "https://images.unsplash.com/photo-1567521464027-f127ff144326?w=400&h=400&fit=crop&crop=face",
      message: "Building places of worship is a sadaqah jariyah that benefits generations. This renovation will serve 200+ worshippers daily for years to come.",
      verified: true
    },
    impactMetrics: {
      familiesHelped: 200,
      peopleReached: 1000,
      mealsProvided: 0,
      childrenSupported: 300
    },
    impactCalculator: [
      { amount: 10000, impact: "Prayer mats", icon: "Mosque" },
      { amount: 50000, impact: "Renovation materials", icon: "Brick" },
      { amount: 100000, impact: "Section renovation", icon: "Tool" },
      { amount: 250000, impact: "Major renovation work", icon: "Build" },
      { amount: 500000, impact: "Complete wing renovation", icon: "Star" }
    ],
    journey: [
      {
        date: "Oct 15, 2024",
        title: "Renovation Project Start",
        description: "Mosque renovation project officially launched with community support.",
        status: "completed"
      },
      {
        date: "Jan 10, 2025",
        title: "Phase 1 Complete",
        description: "Main prayer hall renovation completed. 80% work done.",
        status: "current"
      },
      {
        date: "Mar 2025",
        title: "Grand Opening",
        description: "Complete renovation celebration and opening ceremony planned.",
        status: "upcoming"
      }
    ],
    urgency: {
      type: "deadline",
      message: "60 days to complete renovation",
      count: 60
    }
  }
};

export const categories = ["Zakat", "Infaq", "Sadaqah", "Waqf", "Emergency"];
export const locations = ["Indonesia", "Palestine", "Syria", "Yemen", "Global"];
export const organizations = ["Baznas Indonesia", "Dompet Dhuafa", "Rumah Zakat", "Human Initiative", "Lazismu", "BWI"];

export const calculateProgress = (raised: number, goal: number) => {
  const progress = (raised / goal) * 100;
  return -((100 - progress));
};

export const formatCurrency = (amount: number) => {
  return `${amount.toLocaleString('id-ID', { maximumFractionDigits: 0 })} IDRX`;
};

export const getCampaignById = (id: number) => {
  return campaigns.find((campaign) => campaign.id === id);
};

export const getCampaignBySlug = (slug: string) => {
  return campaigns.find((campaign) => campaign.slug === slug);
};