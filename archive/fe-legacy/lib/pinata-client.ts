import { PinataSDK } from 'pinata-web3';

// Upload file to Pinata via API route
export const uploadFileToPinata = async (file: File): Promise<string> => {
  try {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch('/api/upload-to-pinata', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to upload file');
    }

    const data = await response.json();
    return data.url;
  } catch (error) {
    console.error('Error uploading file to Pinata:', error);
    throw error;
  }
};

// Upload multiple files to Pinata
export const uploadFilesToPinata = async (files: File[]): Promise<string[]> => {
  try {
    const uploadPromises = files.map((file) => uploadFileToPinata(file));
    const urls = await Promise.all(uploadPromises);
    return urls;
  } catch (error) {
    console.error('Error uploading files to Pinata:', error);
    throw error;
  }
};

// Upload JSON metadata to Pinata via API
export const uploadMetadataToPinata = async (metadata: Record<string, any>): Promise<string> => {
  try {
    const blob = new Blob([JSON.stringify(metadata)], { type: 'application/json' });
    const file = new File([blob], 'metadata.json', { type: 'application/json' });

    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch('/api/upload-to-pinata', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to upload metadata');
    }

    const data = await response.json();
    return data.url;
  } catch (error) {
    console.error('Error uploading metadata to Pinata:', error);
    throw error;
  }
};

// Get file from Pinata IPFS
export const getFileFromPinata = async (ipfsHash: string): Promise<string> => {
  const gateway = process.env.NEXT_PUBLIC_PINATA_GATEWAY || 'https://gateway.pinata.cloud';
  return `${gateway}/ipfs/${ipfsHash}`;
};
// Fetch JSON metadata from Pinata IPFS
export const getMetadataFromPinata = async (ipfsHash: string): Promise<Record<string, any> | null> => {
  try {
    const gatewayDomain = process.env.NEXT_PUBLIC_PINATA_GATEWAY || 'gateway.pinata.cloud';
    const gateway = `https://${gatewayDomain.replace(/^https?:\/\//, '')}`;
    const url = `${gateway}/ipfs/${ipfsHash}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      console.warn(`Failed to fetch metadata from Pinata: ${response.statusText}`);
      return null;
    }

    const metadata = await response.json();
    console.log('📋 Metadata fetched from Pinata:', metadata);
    return metadata;
  } catch (error) {
    console.warn('Error fetching metadata from Pinata:', error);
    return null;
  }
};

// Format Pinata image URL properly
export const formatPinataImageUrl = (url: string | undefined): string => {
  if (!url) {
    return 'https://images.unsplash.com/photo-1532629345422-7515f3d16bb6?w=500';
  }

  // Already a full URL (starts with http/https)
  if (url.startsWith('http')) {
    return url;
  }

  // Handle IPFS hash formats
  const gatewayDomain = process.env.NEXT_PUBLIC_PINATA_GATEWAY || 'gateway.pinata.cloud';
  const gateway = `https://${gatewayDomain.replace(/^https?:\/\//, '')}`;
  
  if (url.includes('ipfs')) {
    return url; // Already formatted with ipfs path
  }

  // Pure IPFS hash (bafs... or Qm...)
  if (url.startsWith('bafs') || url.startsWith('Qm')) {
    return `${gateway}/ipfs/${url}`;
  }

  // Just return as-is if we can't determine format
  return url;
};