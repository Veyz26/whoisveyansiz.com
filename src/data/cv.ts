// Everything the site says about Veyansiz, taken from the 2026 CV. Contact details (phone, email) are
// deliberately not here: the static bundle is public, and the contact form relays messages instead.
// Credentials are internationally recognised, exam-based certifications only; courses and training are left out.

export const cvData = {
  personal: {
    name: "Veyansiz Chetty",
    title: "Platform Engineer",
    location: "Gauteng",
    linkedin: "https://www.linkedin.com/in/veyansiz",
    github: "https://github.com/Veyz26",
  },

  profile:
    "Platform Engineer specialising in site reliability and DevOps, with over seven years across cloud engineering, platform operations and service delivery. Builds and runs stable, secure, cost-effective infrastructure, and streamlines operations through automation, monitoring and self-service tooling.",

  // A role whose start month is still ahead shows as "Starts <month>" until it begins.
  experience: [
    {
      title: "Platform Engineer",
      company: "Capitec",
      period: "Dec 2026 – Present",
      summary: "Internal move from systems engineering, specialising in site reliability and DevOps.",
      highlights: [] as string[],
    },
    {
      title: "System Engineer II",
      company: "Capitec",
      period: "Sep 2025 – Nov 2026",
      summary: "Enterprise Windows and Linux administration, patch management, server lifecycle and disaster recovery.",
      highlights: [
        "Deliver enterprise-level Windows and Linux system administration, including monitoring, troubleshooting, incident management and performance optimisation across high-availability environments.",
        "Lead server lifecycle management and end-of-life decommissioning of Windows and RHEL servers, with a focus on compliance, security and risk mitigation.",
        "Co-lead patch management using ManageEngine Patch Manager Plus, driving patch compliance, vulnerability remediation and system stability.",
        "Support disaster recovery and business continuity (for example, Black Friday failover readiness) using Ansible automation, plus VMware storage and virtualisation capacity expansion.",
      ],
    },
    {
      title: "DevOps Engineer II",
      company: "Derivco",
      period: "Sep 2023 – Jun 2025",
      summary: "Azure automation, DevOps platform management and cost optimisation, including the GitLab decommission.",
      highlights: [
        "Led automation projects using Azure Runbooks and PowerShell for VM snapshots and secure access provisioning via Octopus Deploy.",
        "Managed on-premises and Azure-based DevOps platforms (GitLab, ProGet), handling SSL renewals and upgrades for stable service delivery.",
        "Planned and executed the GitLab decommission with a compliant seven-year backup strategy, reducing costs by approximately €7 000 per month.",
        "Analysed Azure disk performance and cost, achieving an estimated €20 000 in annual savings.",
        "Designed Azure dashboards for proactive infrastructure monitoring; automated RBAC provisioning and researched hybrid Okta authentication models.",
      ],
    },
    {
      title: "DevOps Engineer I",
      company: "Derivco",
      period: "Nov 2021 – Aug 2023",
      summary: "Azure infrastructure delivery and CI/CD across GitLab, Azure DevOps and TFS.",
      highlights: [
        "Supported Azure infrastructure delivery and operations across development, QA, database and IT operations teams for smooth, reliable deployments.",
        "Enhanced build and release processes through DevOps migration and automation initiatives.",
        "Managed version control across GitLab, Azure DevOps, TFS and Subversion, ensuring seamless CI/CD pipeline execution.",
        "Applied Agile, Scrum, ITIL and SDLC frameworks while collaborating directly with client teams to gather deployment requirements and align delivery with business goals.",
      ],
    },
    {
      title: "Service Desk Analyst",
      company: "Derivco",
      period: "May 2020 – Oct 2021",
      summary: "First-line support, ITIL incident management and Power BI reporting on IT performance.",
      highlights: [
        "Delivered first-line technical support for Windows systems, VPN connectivity, Active Directory and network troubleshooting, ensuring SLA compliance.",
        "Developed Power BI dashboards integrating on-premises and cloud data sources to monitor IT performance and identify trends.",
        "Managed incidents and service requests per ITIL best practice, driving timely resolution and ongoing service improvement.",
        "Led onboarding and mentoring for new and intern engineers, building a strong foundation in hybrid cloud environments.",
      ],
    },
    {
      title: "Service Desk Analyst – Voice and Network Support",
      company: "AYO Technology Solutions",
      period: "Jun 2018 – Apr 2020",
      summary: "L1 and L2 voice and network support for Sasol across Africa and the United States, with 24/7 on-call.",
      highlights: [
        "Provided L1/L2 voice and network support to Sasol users across Africa and the US, resolving incidents to maintain strict SLA adherence.",
        "Acted as central escalation contact with British Telecom and internal Level 3 teams, prioritising incidents by business impact.",
        "Ensured 24/7 operational support through structured on-call rotations, and produced performance and data quality reports.",
        "Enhanced customer satisfaction through clear communication and consistent, proactive follow-ups.",
      ],
    },
  ],

  education: [
    { degree: "BSc Electrical Engineering", institution: "UKZN", period: "2011 – 2012", note: "Incomplete" },
    { degree: "BSc Business Science", institution: "UKZN", period: "2011 – 2012", note: "Incomplete" },
  ],

  // Newest first.
  certifications: [
    { name: "AWS Certified Solutions Architect – Associate", issuer: "AWS", year: "2026" },
    { name: "Kubernetes and Cloud Native Associate (KCNA)", issuer: "Linux Foundation", year: "2026" },
    { name: "AWS Certified Cloud Practitioner", issuer: "AWS", year: "2026" },
    { name: "LPI Security Essentials", issuer: "Linux Professional Institute", year: "2026" },
    { name: "LPI Linux Essentials", issuer: "Linux Professional Institute", year: "2026" },
    { name: "SDI Service Desk Analyst", issuer: "PeopleCert", year: "2020" },
    { name: "ITIL 4 Foundation", issuer: "PeopleCert", year: "2019" },
  ],

  skills: {
    technical: {
      "Cloud and infrastructure": ["Microsoft Azure", "AWS", "VMware", "Windows Server", "Red Hat Enterprise Linux"],
      "DevOps and automation": ["Azure DevOps", "GitLab CI/CD", "Octopus Deploy", "ProGet", "Ansible", "Docker", "Kubernetes", "Terraform (learning)"],
      "Scripting and data": ["PowerShell", "Python", "SQL", "Power BI"],
      "Operations and reliability": ["Incident management", "Root-cause analysis", "Patch management", "Disaster recovery", "Monitoring dashboards", "24/7 on-call"],
      "Identity, service management and source control": ["Entra ID", "Okta", "ServiceNow", "Git", "GitHub", "Perforce", "TFS"],
    },
  },
} as const;
