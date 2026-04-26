import React from 'react';
import {
  Archive, AlertCircle, AtSign, Bell, Bike, Book, BookOpen, Bookmark, Bot, Calendar,
  Camera, Car, Check, ChevronDown, ChevronUp, Chrome, Circle, Clock, Cloud,
  CloudRain, CloudSnow, Code, Columns, Compass, Copy, CreditCard, Database, Download,
  Edit, ExternalLink, File, FileText, Filter, Flag, Folder, Gamepad2, Github, Gitlab,
  Globe, Grid, Hash, Headphones, Heart, Hexagon, Highlighter, Home, Image, Info,
  Layers, Layout, LayoutGrid, Link, List, Lock, Mail, MapPin, Menu, MessageCircle,
  MessageSquare, Mic, Minus, Moon, MoreVertical, Music, Package, Palette, Pause,
  PenTool, Percent, Phone, Plane, Play, Plus, Rocket, Search, Send, Server,
  Settings, Share, Ship, ShoppingCart, Sidebar, Square, Star, Store, Sun, Tag, Target,
  Terminal, Thermometer, Train, Trash2, Triangle, Truck, Type, Upload, User, Users,
  Volume2, Wifi, Wind, X, Zap, type LucideIcon
} from 'lucide-react';

interface IconProps {
  name: string;
  size?: number;
  className?: string;
}

const iconMap: Record<string, LucideIcon> = {
  Archive, AlertCircle, AtSign, Bell, Bike, Book, BookOpen, Bookmark, Bot, Calendar,
  Camera, Car, Check, ChevronDown, ChevronUp, Chrome, Circle, Clock, Cloud,
  CloudRain, CloudSnow, Code, Columns, Compass, Copy, CreditCard, Database, Download,
  Edit, Edge: Chrome, ExternalLink, File, FileText, Filter, Firefox: Chrome, Flag,
  Folder, Gamepad2, Github, Gitlab, Globe, Grid, Hash, Headphones, Heart, Hexagon,
  Highlighter, Home, Image, Info, Layers, Layout, LayoutGrid, Link, List, Lock, Mail,
  MapPin, Menu, MessageCircle, MessageSquare, Mic, Minus, Moon, MoreVertical, Music,
  Package, Palette, Pause, PenTool, Percent, Phone, Plane, Play, Plus, Rocket,
  Safari: Chrome, Search, Send, Server, Settings, Share, Ship, ShoppingCart, Sidebar, Square, Star,
  Store, Sun, Tag, Target, Terminal, Thermometer, Train, Trash2, Triangle, Truck,
  Type, Upload, User, Users, Volume2, Wifi, Wind, X, Zap
};

export const getSupportedIconName = (iconName: string) => {
  const trimmedName = iconName.trim();
  if (!trimmedName) return '';

  const pascalName = trimmedName.includes('-')
    ? trimmedName.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join('')
    : trimmedName;

  if (iconMap[pascalName]) return pascalName;

  const capitalizedName = pascalName.charAt(0).toUpperCase() + pascalName.slice(1);
  return iconMap[capitalizedName] ? capitalizedName : '';
};

export const hasSupportedIcon = (iconName: string) => Boolean(getSupportedIconName(iconName));

const Icon: React.FC<IconProps> = ({ name, size = 20, className }) => {
  const supportedName = getSupportedIconName(name);
  const IconComponent = iconMap[supportedName] || Link;
  return <IconComponent size={size} className={className} />;
};

export default Icon;