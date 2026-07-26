"use client";

import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useState } from "react";
import { useLanguage } from "@/components/providers/language-provider";

const icon = L.icon({
    iconUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png",
    iconRetinaUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png",
    shadowUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png",
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
});

interface Location {
    lat: number;
    lng: number;
    name: string;
    description?: string;
}

interface CampaignMapProps {
    locations?: Location[];
    center?: [number, number];
    zoom?: number;
}

const CampaignMap = ({
    locations = [],
    center = [-6.2088, 106.8456],
    zoom = 13
}: CampaignMapProps) => {
    const { t } = useLanguage();
    const [isMounted, setIsMounted] = useState(false);

    useEffect(() => {
        setIsMounted(true);
    }, []);

    if (!isMounted) {
        return (
            <div className="w-full h-[400px] bg-muted animate-pulse rounded-xl flex items-center justify-center">
                <span className="text-muted-foreground">{t("map.loading")}</span>
            </div>
        );
    }

    return (
        <div className="w-full h-[400px] rounded-xl overflow-hidden border border-border z-0 relative">
            <MapContainer
                center={center}
                zoom={zoom}
                style={{ height: "100%", width: "100%" }}
                scrollWheelZoom={false}
            >
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {locations.map((loc, idx) => (
                    <Marker
                        key={idx}
                        position={[loc.lat, loc.lng]}
                        icon={icon}
                    >
                        <Popup>
                            <div className="p-2">
                                <h3 className="font-bold text-sm mb-1">{loc.name}</h3>
                                {loc.description && <p className="text-xs text-muted-foreground m-0">{loc.description}</p>}
                            </div>
                        </Popup>
                    </Marker>
                ))}
            </MapContainer>
        </div>
    );
};

export default CampaignMap;
